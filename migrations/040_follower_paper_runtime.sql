BEGIN;

CREATE TABLE copy.follower_paper_action_plan(
  follower_action_plan_id text PRIMARY KEY CHECK(length(follower_action_plan_id)>=16),
  follower_order_intent_id text NOT NULL UNIQUE REFERENCES copy.follower_order_intent(follower_order_intent_id),
  follower_copy_event_id text NOT NULL REFERENCES copy.follower_copy_event(follower_copy_event_id),
  workspace_id uuid NOT NULL,
  follower_account_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN('OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN',
    'SELL_STOCK','OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN')),
  symbol text NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0),
  side text NOT NULL CHECK(side IN('BUY','SELL')),
  position_intent text CHECK(position_intent IN('BUY_TO_CLOSE','SELL_TO_OPEN')),
  limit_price numeric(24,8) NOT NULL CHECK(limit_price>0),
  client_order_id text NOT NULL UNIQUE,
  quote_json jsonb NOT NULL CHECK(jsonb_typeof(quote_json)='object'),
  quote_age_ms integer NOT NULL CHECK(quote_age_ms>=0),
  aegis_state text NOT NULL CHECK(aegis_state IN('ALLOW_FULL','ALLOW_REDUCED')),
  aegis_policy_version text NOT NULL,
  decision_expires_at timestamptz NOT NULL,
  execution_gate text NOT NULL DEFAULT 'FOLLOWER_EXECUTION_DISABLED'
    CHECK(execution_gate='FOLLOWER_EXECUTION_DISABLED'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL CHECK(created_at<decision_expires_at),
  CONSTRAINT follower_paper_action_plan_order_shape CHECK(
    (action IN('OPEN_CSP','ROLL_CSP_OPEN','OPEN_CC','ROLL_CC_OPEN') AND side='SELL' AND position_intent='SELL_TO_OPEN') OR
    (action IN('REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE') AND side='BUY' AND position_intent='BUY_TO_CLOSE') OR
    (action='SELL_STOCK' AND side='SELL' AND position_intent IS NULL)
  ),
  FOREIGN KEY(workspace_id,follower_account_id)
    REFERENCES copy.follower_account(workspace_id,follower_account_id)
);
CREATE INDEX ix_follower_paper_action_plan_account
  ON copy.follower_paper_action_plan(follower_account_id,created_at DESC);

ALTER TABLE copy.follower_reconciliation_event ADD COLUMN event_key char(64);
CREATE UNIQUE INDEX ux_follower_reconciliation_event_key
  ON copy.follower_reconciliation_event(event_key);

CREATE TABLE copy.follower_paper_action_plan_event(
  follower_action_plan_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  follower_action_plan_id text NOT NULL REFERENCES copy.follower_paper_action_plan(follower_action_plan_id),
  event_kind text NOT NULL CHECK(event_kind IN('PLANNED_LOCKED','BROKER_ABSENT','SUBMITTED_EXTERNALLY',
    'PARTIAL_FILL','FILLED','CANCELED','REJECTED','UNKNOWN_SUBMISSION')),
  broker_order_id text,
  filled_quantity numeric(20,8) CHECK(filled_quantity IS NULL OR filled_quantity>=0),
  requires_reconciliation boolean NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  occurred_at timestamptz NOT NULL,
  event_key char(64) NOT NULL UNIQUE
);

CREATE TABLE copy.follower_lifecycle_divergence_event(
  follower_divergence_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  follower_account_id uuid NOT NULL,
  master_copy_event_id text NOT NULL REFERENCES copy.master_copy_event(master_copy_event_id),
  master_chain_id uuid REFERENCES trade.economic_chain(chain_id),
  divergence_kind text NOT NULL CHECK(divergence_kind IN('MISSED_MASTER_ENTRY','PARTIAL_FILL','CSP_CLOSE_DIVERGED',
    'CSP_ROLL_DIVERGED','ASSIGNMENT_DIVERGED','STOCK_RECOVERY_DIVERGED','COVERED_CALL_DIVERGED',
    'CALL_AWAY_DIVERGED','PAUSED_MANAGING_EXISTING','RESTART_RECONCILIATION_REQUIRED','BROKER_POSITION_DIVERGED')),
  detail_json jsonb NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  detected_at timestamptz NOT NULL,
  event_key char(64) NOT NULL UNIQUE,
  FOREIGN KEY(workspace_id,follower_account_id)
    REFERENCES copy.follower_account(workspace_id,follower_account_id)
);
CREATE INDEX ix_follower_divergence_account
  ON copy.follower_lifecycle_divergence_event(follower_account_id,detected_at DESC);

CREATE TABLE copy.follower_runtime_checkpoint(
  workspace_id uuid NOT NULL,
  follower_account_id uuid NOT NULL,
  runtime_state text NOT NULL CHECK(runtime_state IN('READY','PAUSED_MANAGING_EXISTING','RECONCILING','BLOCKED','DISCONNECTED')),
  last_master_copy_event_id text REFERENCES copy.master_copy_event(master_copy_event_id),
  last_follower_action_plan_id text REFERENCES copy.follower_paper_action_plan(follower_action_plan_id),
  last_reconciled_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(follower_account_id),
  FOREIGN KEY(workspace_id,follower_account_id)
    REFERENCES copy.follower_account(workspace_id,follower_account_id)
);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['follower_paper_action_plan','follower_paper_action_plan_event','follower_lifecycle_divergence_event'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON copy.%I',table_name);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON copy.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',table_name);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('040_follower_paper_runtime',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
