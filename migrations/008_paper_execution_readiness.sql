BEGIN;

DO $$ BEGIN
  CREATE TYPE trade.execution_account_kind AS ENUM ('MASTER_API_KEY', 'FOLLOWER_OAUTH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trade.assignment_reconciliation_state AS ENUM ('PROVISIONAL', 'CONFIRMED', 'QUARANTINED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trade.execution_account (
  execution_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_kind trade.execution_account_kind NOT NULL,
  follower_account_id uuid REFERENCES copy.follower_account(follower_account_id),
  environment text NOT NULL DEFAULT 'PAPER' CHECK (environment = 'PAPER'),
  provider_account_ref_hash char(64) NOT NULL,
  provider_account_ref_masked text NOT NULL,
  account_ready boolean NOT NULL DEFAULT false,
  options_approved_level integer,
  options_trading_level integer,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (account_kind = 'MASTER_API_KEY' AND follower_account_id IS NULL)
    OR (account_kind = 'FOLLOWER_OAUTH' AND follower_account_id IS NOT NULL)
  ),
  UNIQUE (account_kind, provider_account_ref_hash)
);

ALTER TABLE trade.order_intent
  ADD COLUMN IF NOT EXISTS execution_account_id uuid REFERENCES trade.execution_account(execution_account_id),
  ADD COLUMN IF NOT EXISTS theta_action text,
  ADD COLUMN IF NOT EXISTS broker_symbol text,
  ADD COLUMN IF NOT EXISTS quote_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS decision_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS aegis_state text,
  ADD COLUMN IF NOT EXISTS intent_persisted_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS trade.execution_attempt (
  execution_attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  requested_at timestamptz NOT NULL,
  request_payload_hash char(64) NOT NULL,
  response_at timestamptz,
  response_status text,
  timeout_flag boolean NOT NULL DEFAULT false,
  reconcile_before_retry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_intent_id, attempt_no),
  CHECK (timeout_flag = false OR reconcile_before_retry = true)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_broker_order_provider_id
  ON trade.broker_order(provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trade.broker_order_event (
  broker_order_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  broker_order_id uuid NOT NULL REFERENCES trade.broker_order(broker_order_id),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  event_time timestamptz,
  quantity_delta numeric(20,8),
  price_per_share numeric(20,8),
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broker_order_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS trade.assignment_reconciliation (
  assignment_reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_key char(64) NOT NULL UNIQUE,
  execution_account_id uuid NOT NULL REFERENCES trade.execution_account(execution_account_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  option_symbol text NOT NULL,
  underlying_symbol text NOT NULL,
  occurrence_date date NOT NULL,
  state trade.assignment_reconciliation_state NOT NULL,
  stock_quantity numeric(20,8) NOT NULL CHECK (stock_quantity > 0),
  provider_activity_id text,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'CONFIRMED') = (provider_activity_id IS NOT NULL AND confirmed_at IS NOT NULL)),
  UNIQUE (execution_account_id, chain_id, option_symbol, occurrence_date)
);

CREATE TABLE IF NOT EXISTS ops.paper_execution_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  pause_new_orders boolean NOT NULL DEFAULT true,
  master_execution_enabled boolean NOT NULL DEFAULT false,
  follower_execution_enabled boolean NOT NULL DEFAULT false,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ops.paper_execution_control(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_order_intent_restart_recovery
  ON trade.order_intent(execution_account_id, status, updated_at)
  WHERE status IN ('SUBMITTING', 'UNKNOWN_SUBMISSION', 'RECONCILING', 'PARTIAL');

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['broker_order_event'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO core.schema_migration(version, checksum)
VALUES ('008_paper_execution_readiness', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
