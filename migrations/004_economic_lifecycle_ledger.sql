BEGIN;

-- R2 durable ledger: decision -> order intent -> broker acknowledgement ->
-- fill -> option leg -> close/roll/expire/assign -> stock lot -> recovery
-- -> covered call -> exit, plus reconciliation. Extends 003's immutable
-- decision truth (trade.fusion_snapshot/candidate_set/candidate/decision)
-- with everything downstream of a decision. PostgreSQL remains the durable
-- economic truth; Redis (not modeled here) stays coordination/hot-state
-- only, per this repository's standing rule.

DO $$ BEGIN
  CREATE TYPE trade.order_intent_status AS ENUM (
    'PROPOSED', 'PREFLIGHT', 'READY', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED',
    'PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'REJECTED', 'EXPIRED',
    'UNKNOWN_SUBMISSION', 'RECONCILING'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trade.lifecycle_state AS ENUM (
    'WAIT', 'CSP_PROPOSED', 'CSP_OPEN', 'BTC_CLOSE', 'EXPIRE_OTM', 'ROLL_DECISION',
    'ASSIGNED', 'STOCK_HELD', 'RECOVERY_WAIT', 'CC_PROPOSED', 'CC_OPEN', 'CLOSE_CC',
    'CALL_AWAY', 'CLOSE_STOCK', 'REDEPLOY', 'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trade.reconciliation_state AS ENUM (
    'MATCHED', 'PENDING', 'PARTIAL_FILL', 'UNKNOWN_SUBMISSION', 'BROKER_ONLY_ORDER',
    'LOCAL_ONLY_INTENT', 'POSITION_MISMATCH', 'FILL_MISMATCH', 'ASSIGNMENT_DETECTED',
    'EXPIRY_DETECTED', 'CORPORATE_ACTION_REVIEW', 'RECONCILIATION_REQUIRED', 'QUARANTINED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One Wheel lineage: CSP -> roll* -> assignment? -> stock -> recovery ->
-- CC* -> exit. Every option_leg/stock_lot below belongs to exactly one
-- chain, so a full economic history can be reconstructed from one id.
CREATE TABLE IF NOT EXISTS trade.economic_chain (
  chain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id),
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  lifecycle_state trade.lifecycle_state NOT NULL DEFAULT 'WAIT',
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_economic_chain_open ON trade.economic_chain(bot_instance_id) WHERE closed_at IS NULL;

-- One option leg's lifecycle. A roll is CLOSE OLD + OPEN NEW: it never
-- mutates this row's realized_pnl once set (enforced below) -- rolling
-- links two DISTINCT rows via rolled_from/rolled_to instead.
CREATE TABLE IF NOT EXISTS trade.option_leg (
  option_leg_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id),
  decision_id uuid REFERENCES trade.decision(decision_id),
  side text NOT NULL CHECK (side IN ('SHORT', 'LONG')),
  quantity numeric(20,8) NOT NULL CHECK (quantity >= 0),
  entry_price_per_share numeric(20,8),
  entry_credit_debit numeric(24,8),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason text CHECK (close_reason IS NULL OR close_reason IN ('BTC_CLOSE', 'EXPIRE_OTM', 'ROLLED', 'ASSIGNED', 'EXERCISED')),
  close_price_per_share numeric(20,8),
  realized_pnl numeric(24,8),
  rolled_from_option_leg_id uuid REFERENCES trade.option_leg(option_leg_id),
  rolled_to_option_leg_id uuid REFERENCES trade.option_leg(option_leg_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (closed_at IS NULL OR (close_reason IS NOT NULL AND realized_pnl IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_option_leg_chain ON trade.option_leg(chain_id, opened_at);

-- Post-assignment stock inventory. Unrealized loss stays visible via
-- disposed_at IS NULL rows joined against a current-price feed elsewhere --
-- this table never hides an open stock position by omission, and never
-- marks assignment as an automatic win: realized_pnl is only set once the
-- lot is actually disposed of.
CREATE TABLE IF NOT EXISTS trade.stock_lot (
  stock_lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  shares numeric(20,8) NOT NULL CHECK (shares >= 0),
  economic_basis_per_share numeric(20,8) NOT NULL,
  broker_basis_per_share numeric(20,8),
  assignment_option_leg_id uuid REFERENCES trade.option_leg(option_leg_id),
  acquired_at timestamptz NOT NULL,
  disposed_at timestamptz,
  disposed_price_per_share numeric(20,8),
  realized_pnl numeric(24,8),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (disposed_at IS NULL OR realized_pnl IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_stock_lot_open ON trade.stock_lot(chain_id) WHERE disposed_at IS NULL;

-- Order intent state machine (mirrors src/theta/order-intent-state.ts
-- exactly). UNKNOWN_SUBMISSION's only valid next state is RECONCILING --
-- enforced at the TypeScript layer's transition table; this table just
-- persists whatever state that layer already validated, never bypasses it.
CREATE TABLE IF NOT EXISTS trade.order_intent (
  order_intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid REFERENCES trade.economic_chain(chain_id),
  decision_id uuid REFERENCES trade.decision(decision_id),
  client_order_id text NOT NULL UNIQUE,
  status trade.order_intent_status NOT NULL DEFAULT 'PROPOSED',
  instrument_type text NOT NULL CHECK (instrument_type IN ('OPTION', 'STOCK')),
  option_contract_id uuid REFERENCES market.option_contract(option_contract_id),
  underlying_id uuid REFERENCES market.underlying(underlying_id),
  side text NOT NULL,
  quantity numeric(20,8) NOT NULL CHECK (quantity >= 0),
  limit_price numeric(20,8),
  time_in_force text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_intent_open ON trade.order_intent(status)
  WHERE status NOT IN ('FILLED', 'CANCELED', 'REJECTED', 'EXPIRED');

CREATE TABLE IF NOT EXISTS trade.broker_order (
  broker_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  provider_order_id text,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  broker_status text,
  raw_payload_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_intent_id, provider_order_id)
);

-- Fills are immutable facts once recorded (append-only, enforced below).
CREATE TABLE IF NOT EXISTS trade.fill (
  fill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_order_id uuid NOT NULL REFERENCES trade.broker_order(broker_order_id),
  provider_fill_id text,
  quantity numeric(20,8) NOT NULL CHECK (quantity > 0),
  price_per_share numeric(20,8) NOT NULL,
  filled_at timestamptz NOT NULL,
  fees numeric(20,8) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broker_order_id, provider_fill_id)
);

CREATE TABLE IF NOT EXISTS trade.assignment_event (
  assignment_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_leg_id uuid NOT NULL REFERENCES trade.option_leg(option_leg_id),
  stock_lot_id uuid REFERENCES trade.stock_lot(stock_lot_id),
  assigned_at timestamptz NOT NULL,
  shares numeric(20,8) NOT NULL CHECK (shares > 0),
  strike_price numeric(20,8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade.expiration_event (
  expiration_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_leg_id uuid NOT NULL REFERENCES trade.option_leg(option_leg_id),
  expired_at timestamptz NOT NULL,
  itm boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade.dividend_event (
  dividend_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_lot_id uuid NOT NULL REFERENCES trade.stock_lot(stock_lot_id),
  ex_date date NOT NULL,
  amount_per_share numeric(20,8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade.fee_event (
  fee_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  fee_type text NOT NULL,
  amount numeric(20,8) NOT NULL,
  incurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Broker-vs-internal-expected-state comparison. UNKNOWN_SUBMISSION rows
-- here are exactly what src/theta/order-intent-state.ts's
-- RECONCILE_BEFORE_RETRY path exists to resolve -- never bypassed by a
-- blind resubmission.
CREATE TABLE IF NOT EXISTS trade.reconciliation_event (
  reconciliation_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_intent_id uuid REFERENCES trade.order_intent(order_intent_id),
  chain_id uuid REFERENCES trade.economic_chain(chain_id),
  state trade.reconciliation_state NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_reconciliation_open ON trade.reconciliation_event(state) WHERE resolved_at IS NULL;

-- Realized P&L, once set, is immutable -- a later correction requires a
-- new row (e.g. a corporate-action adjustment event), never an UPDATE of
-- an existing realized_pnl value. This is the enforcement mechanism behind
-- "old realized roll/assignment losses never disappear."
CREATE OR REPLACE FUNCTION trade.reject_realized_pnl_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.realized_pnl IS NOT NULL AND NEW.realized_pnl IS DISTINCT FROM OLD.realized_pnl THEN
    RAISE EXCEPTION 'realized_pnl is immutable once set on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.realized_pnl IS NOT NULL THEN
    RAISE EXCEPTION 'cannot delete a row with realized_pnl already set on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS reject_realized_pnl_mutation ON trade.option_leg;
CREATE TRIGGER reject_realized_pnl_mutation BEFORE UPDATE OR DELETE ON trade.option_leg
  FOR EACH ROW EXECUTE FUNCTION trade.reject_realized_pnl_mutation();

DROP TRIGGER IF EXISTS reject_realized_pnl_mutation ON trade.stock_lot;
CREATE TRIGGER reject_realized_pnl_mutation BEFORE UPDATE OR DELETE ON trade.stock_lot
  FOR EACH ROW EXECUTE FUNCTION trade.reject_realized_pnl_mutation();

-- Fully append-only tables (reusing 003's core.reject_immutable_mutation):
-- fills and assignment/expiration/dividend events are facts, not states,
-- and are never edited or deleted once recorded.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['fill', 'assignment_event', 'expiration_event', 'dividend_event'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO core.schema_migration (version, checksum)
VALUES ('004_economic_lifecycle_ledger', '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
