BEGIN;

CREATE SCHEMA IF NOT EXISTS copy;

DO $$ BEGIN
  CREATE TYPE copy.participation_state AS ENUM (
    'COPY_NEW_AND_MANAGE',
    'STOP_NEW_TRADES_MANAGE_EXISTING',
    'DISCONNECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE copy.sync_state AS ENUM (
    'SYNCED',
    'PENDING_SYNC',
    'PARTIAL_SYNC',
    'DIVERGED',
    'BLOCKED',
    'RECONCILING'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE copy.copy_outcome AS ENUM (
    'COPY_FULL',
    'COPY_REDUCED',
    'SKIP_ACCOUNT',
    'BLOCKED',
    'RECONCILE',
    'DUPLICATE_NOOP'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE copy.follower_order_state AS ENUM (
    'PLANNED',
    'SUBMITTING',
    'ACCEPTED',
    'PARTIAL_FILL',
    'FILLED',
    'CANCELED',
    'REJECTED',
    'UNKNOWN_SUBMISSION',
    'RECONCILING'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS copy.follower_account (
  follower_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id),
  provider_code text NOT NULL DEFAULT 'ALPACA' CHECK (provider_code = 'ALPACA'),
  environment text NOT NULL DEFAULT 'PAPER' CHECK (environment = 'PAPER'),
  provider_account_ref text NOT NULL,
  oauth_secret_ref text NOT NULL CHECK (length(trim(oauth_secret_ref)) > 0),
  participation copy.participation_state NOT NULL DEFAULT 'COPY_NEW_AND_MANAGE',
  account_ready boolean NOT NULL DEFAULT false,
  options_approved boolean,
  last_broker_sync_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider_code, provider_account_ref),
  CHECK (
    (participation = 'DISCONNECTED' AND disconnected_at IS NOT NULL)
    OR (participation <> 'DISCONNECTED' AND disconnected_at IS NULL)
  )
);

COMMENT ON COLUMN copy.follower_account.oauth_secret_ref IS
  'Opaque reference to encrypted secret storage. OAuth tokens are never stored in this table.';

CREATE TABLE IF NOT EXISTS copy.follower_policy (
  follower_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_account_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  policy_version text NOT NULL,
  allocation_usd numeric(24,8) NOT NULL CHECK (allocation_usd >= 0),
  max_bot_capital_pct numeric(9,6) NOT NULL CHECK (max_bot_capital_pct BETWEEN 0 AND 100),
  max_ticker_exposure_pct numeric(9,6) NOT NULL CHECK (max_ticker_exposure_pct BETWEEN 0 AND 100),
  max_contracts integer NOT NULL CHECK (max_contracts >= 0),
  max_daily_loss_usd numeric(24,8) NOT NULL CHECK (max_daily_loss_usd >= 0),
  max_open_positions integer NOT NULL CHECK (max_open_positions >= 0),
  max_slippage_per_contract_usd numeric(24,8) NOT NULL CHECK (max_slippage_per_contract_usd >= 0),
  join_existing_positions boolean NOT NULL DEFAULT false CHECK (join_existing_positions = false),
  start_new_trades_only boolean NOT NULL DEFAULT true CHECK (start_new_trades_only = true),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (follower_account_id, policy_version),
  UNIQUE (follower_policy_id, follower_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_follower_policy_active
  ON copy.follower_policy(follower_account_id) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS copy.master_copy_event (
  master_copy_event_id text PRIMARY KEY,
  master_bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id),
  master_decision_id uuid REFERENCES trade.decision(decision_id),
  master_chain_id uuid REFERENCES trade.economic_chain(chain_id),
  master_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id),
  master_fill_id uuid REFERENCES trade.fill(fill_id),
  action text NOT NULL CHECK (action IN (
    'OPEN_CSP', 'REDUCE_CSP', 'CLOSE_CSP', 'ROLL_CSP', 'EXPIRE_CSP',
    'ASSIGN_STOCK', 'HOLD_STOCK', 'SELL_STOCK', 'OPEN_CC', 'REDUCE_CC',
    'CLOSE_CC', 'ROLL_CC', 'EXPIRE_CC', 'CALL_AWAY'
  )),
  symbol text NOT NULL,
  master_quantity numeric(20,8) NOT NULL CHECK (master_quantity >= 0),
  master_filled_quantity numeric(20,8) NOT NULL CHECK (
    master_filled_quantity >= 0 AND master_filled_quantity <= master_quantity
  ),
  occurred_at timestamptz NOT NULL,
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copy.follower_copy_event (
  follower_copy_event_id text PRIMARY KEY,
  master_copy_event_id text NOT NULL REFERENCES copy.master_copy_event(master_copy_event_id),
  follower_account_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  follower_policy_id uuid NOT NULL,
  outcome copy.copy_outcome NOT NULL,
  sync_state copy.sync_state NOT NULL,
  intended_quantity numeric(20,8) NOT NULL CHECK (intended_quantity >= 0),
  close_quantity numeric(20,8) NOT NULL CHECK (close_quantity >= 0),
  open_quantity numeric(20,8) NOT NULL CHECK (open_quantity >= 0),
  reason text NOT NULL,
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_copy_event_id, follower_account_id),
  FOREIGN KEY (follower_policy_id, follower_account_id)
    REFERENCES copy.follower_policy(follower_policy_id, follower_account_id)
);
CREATE INDEX IF NOT EXISTS ix_follower_copy_event_sync
  ON copy.follower_copy_event(follower_account_id, sync_state, created_at DESC);

CREATE TABLE IF NOT EXISTS copy.follower_order_intent (
  follower_order_intent_id text PRIMARY KEY,
  follower_copy_event_id text NOT NULL REFERENCES copy.follower_copy_event(follower_copy_event_id),
  client_order_id text NOT NULL UNIQUE,
  state copy.follower_order_state NOT NULL DEFAULT 'PLANNED',
  broker_order_id text,
  quantity numeric(20,8) NOT NULL CHECK (quantity >= 0),
  limit_price numeric(20,8),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_copy_event_id, attempt),
  CHECK (quantity > 0 OR state = 'PLANNED')
);
CREATE INDEX IF NOT EXISTS ix_follower_order_reconcile
  ON copy.follower_order_intent(state, updated_at)
  WHERE state IN ('PARTIAL_FILL', 'UNKNOWN_SUBMISSION', 'RECONCILING');

CREATE TABLE IF NOT EXISTS copy.follower_fill (
  follower_fill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_order_intent_id text NOT NULL REFERENCES copy.follower_order_intent(follower_order_intent_id),
  provider_fill_id text NOT NULL,
  quantity numeric(20,8) NOT NULL CHECK (quantity > 0),
  price_per_share numeric(20,8) NOT NULL,
  fees numeric(20,8) NOT NULL DEFAULT 0,
  filled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_order_intent_id, provider_fill_id)
);

CREATE TABLE IF NOT EXISTS copy.follower_reconciliation_event (
  follower_reconciliation_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  follower_account_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  follower_copy_event_id text REFERENCES copy.follower_copy_event(follower_copy_event_id),
  follower_order_intent_id text REFERENCES copy.follower_order_intent(follower_order_intent_id),
  state copy.sync_state NOT NULL,
  broker_quantity numeric(20,8) CHECK (broker_quantity >= 0),
  expected_quantity numeric(20,8) CHECK (expected_quantity >= 0),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolution_of_event_id bigint REFERENCES copy.follower_reconciliation_event(follower_reconciliation_event_id)
);
CREATE INDEX IF NOT EXISTS ix_follower_reconciliation_state
  ON copy.follower_reconciliation_event(follower_account_id, state, detected_at DESC);

CREATE TABLE IF NOT EXISTS copy.operator_audit_event (
  operator_audit_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_subject text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  request_id text,
  result text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'master_copy_event',
    'follower_copy_event',
    'follower_fill',
    'follower_reconciliation_event',
    'operator_audit_event'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON copy.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON copy.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO core.schema_migration (version, checksum)
VALUES ('005_follower_copy_engine', '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
