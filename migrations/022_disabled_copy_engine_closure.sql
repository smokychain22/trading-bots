BEGIN;

DO $$ BEGIN
  ALTER TABLE copy.follower_account
    ADD CONSTRAINT follower_account_workspace_identity UNIQUE(workspace_id,follower_account_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

ALTER TABLE copy.master_copy_event DROP CONSTRAINT IF EXISTS master_copy_event_action_check;
ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_action_check CHECK(action IN(
  'OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','EXPIRE_CSP',
  'ASSIGN_STOCK','HOLD_STOCK','SELL_STOCK','OPEN_CC','REDUCE_CC','CLOSE_CC',
  'ROLL_CC_CLOSE','ROLL_CC_OPEN','EXPIRE_CC','CALL_AWAY'));
ALTER TABLE copy.master_copy_event DROP CONSTRAINT IF EXISTS master_copy_event_confirmation_matches_action;
ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_confirmation_matches_action CHECK(
  (action IN('OPEN_CSP','REDUCE_CSP','CLOSE_CSP','ROLL_CSP_CLOSE','ROLL_CSP_OPEN','SELL_STOCK',
    'OPEN_CC','REDUCE_CC','CLOSE_CC','ROLL_CC_CLOSE','ROLL_CC_OPEN') AND broker_confirmation_kind='FILL') OR
  (action IN('EXPIRE_CSP','ASSIGN_STOCK','HOLD_STOCK','EXPIRE_CC','CALL_AWAY') AND broker_confirmation_kind='LIFECYCLE_ACTIVITY'));
ALTER TABLE copy.master_copy_event DROP CONSTRAINT IF EXISTS master_copy_event_roll_lineage;
ALTER TABLE copy.master_copy_event ADD CONSTRAINT master_copy_event_roll_lineage CHECK(
  action NOT IN('ROLL_CSP_OPEN','ROLL_CC_OPEN') OR parent_master_copy_event_id IS NOT NULL);

ALTER TABLE copy.follower_copy_event
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS copy_state text NOT NULL DEFAULT 'EXECUTION_DISABLED'
    CHECK(copy_state IN('NOT_APPLICABLE','PLANNED','BLOCKED','SKIPPED','AWAITING_EXECUTION','EXECUTION_DISABLED','SUBMITTED','PARTIAL','FILLED','CANCELLED','FAILED')),
  ADD COLUMN IF NOT EXISTS follower_broker_activity_fact_id uuid REFERENCES trade.broker_activity_fact(broker_activity_fact_id),
  ADD COLUMN IF NOT EXISTS economic_direction text CHECK(economic_direction IN('CREDIT','DEBIT')),
  ADD COLUMN IF NOT EXISTS master_execution_price numeric(24,8),
  ADD COLUMN IF NOT EXISTS follower_observed_price numeric(24,8),
  ADD COLUMN IF NOT EXISTS price_deterioration_per_share numeric(24,8),
  ADD COLUMN IF NOT EXISTS master_fill_time timestamptz,
  ADD COLUMN IF NOT EXISTS copy_event_time timestamptz,
  ADD COLUMN IF NOT EXISTS follower_observation_time timestamptz,
  ADD COLUMN IF NOT EXISTS follower_quote_time timestamptz,
  ADD COLUMN IF NOT EXISTS quote_age_ms integer CHECK(quote_age_ms IS NULL OR quote_age_ms>=0),
  ADD COLUMN IF NOT EXISTS planned_contract_id text,
  ADD COLUMN IF NOT EXISTS pricing_policy_version text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
UPDATE copy.follower_copy_event fce SET workspace_id=fa.workspace_id
  FROM copy.follower_account fa WHERE fa.follower_account_id=fce.follower_account_id AND fce.workspace_id IS NULL;
ALTER TABLE copy.follower_copy_event ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE copy.follower_copy_event DROP CONSTRAINT IF EXISTS follower_copy_event_workspace_account_fk;
ALTER TABLE copy.follower_copy_event ADD CONSTRAINT follower_copy_event_workspace_account_fk
  FOREIGN KEY(workspace_id,follower_account_id) REFERENCES copy.follower_account(workspace_id,follower_account_id);
ALTER TABLE copy.follower_copy_event DROP CONSTRAINT IF EXISTS follower_copy_event_copy_locked;
ALTER TABLE copy.follower_copy_event ADD CONSTRAINT follower_copy_event_copy_locked CHECK(
  execution_authorized=false AND copy_state NOT IN('AWAITING_EXECUTION','SUBMITTED','PARTIAL','FILLED'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_follower_copy_event_idempotency ON copy.follower_copy_event(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS copy.follower_chain_participation(
  workspace_id uuid NOT NULL,
  follower_account_id uuid NOT NULL,
  master_chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  entry_state text NOT NULL CHECK(entry_state IN('PLANNED','SKIPPED','CONFIRMED')),
  entry_participated boolean NOT NULL DEFAULT false,
  follower_chain_id uuid REFERENCES trade.economic_chain(chain_id),
  current_lifecycle_state text NOT NULL,
  skip_reason text,
  last_master_copy_event_id text REFERENCES copy.master_copy_event(master_copy_event_id),
  last_follower_broker_activity_fact_id uuid REFERENCES trade.broker_activity_fact(broker_activity_fact_id),
  policy_version text NOT NULL,
  version_lineage_json jsonb NOT NULL CHECK(jsonb_typeof(version_lineage_json)='object'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(follower_account_id,master_chain_id),
  FOREIGN KEY(workspace_id,follower_account_id) REFERENCES copy.follower_account(workspace_id,follower_account_id),
  CHECK((entry_state='CONFIRMED')=entry_participated),
  CHECK((entry_participated AND follower_chain_id IS NOT NULL) OR (NOT entry_participated AND follower_chain_id IS NULL)),
  CHECK(entry_state<>'SKIPPED' OR skip_reason IS NOT NULL)
);
DO $$ BEGIN
  ALTER TABLE copy.follower_chain_participation
    ADD CONSTRAINT follower_chain_participation_workspace_identity
    UNIQUE(workspace_id,follower_account_id,master_chain_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS copy.follower_chain_participation_event(
  participation_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  follower_account_id uuid NOT NULL,
  master_chain_id uuid NOT NULL,
  event_kind text NOT NULL CHECK(event_kind IN('ENTRY_PLANNED','ENTRY_SKIPPED','ENTRY_CONFIRMED','LIFECYCLE_REVIEW')),
  master_copy_event_id text NOT NULL REFERENCES copy.master_copy_event(master_copy_event_id),
  follower_broker_activity_fact_id uuid REFERENCES trade.broker_activity_fact(broker_activity_fact_id),
  detail_json jsonb NOT NULL CHECK(jsonb_typeof(detail_json)='object'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY(follower_account_id,master_chain_id)
    REFERENCES copy.follower_chain_participation(follower_account_id,master_chain_id)
);
ALTER TABLE copy.follower_chain_participation_event
  DROP CONSTRAINT IF EXISTS follower_chain_participation_event_workspace_fk;
ALTER TABLE copy.follower_chain_participation_event
  ADD CONSTRAINT follower_chain_participation_event_workspace_fk
  FOREIGN KEY(workspace_id,follower_account_id,master_chain_id)
  REFERENCES copy.follower_chain_participation(workspace_id,follower_account_id,master_chain_id);
DROP TRIGGER IF EXISTS reject_immutable_mutation ON copy.follower_chain_participation_event;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON copy.follower_chain_participation_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION copy.guard_disabled_follower_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE master_action text; master_chain uuid; account_workspace uuid; broker_connection uuid;
BEGIN
  SELECT workspace_id INTO account_workspace FROM copy.follower_account
    WHERE follower_account_id=NEW.follower_account_id;
  IF account_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'FOLLOWER_TENANT_BOUNDARY_VIOLATION' USING ERRCODE='23514';
  END IF;
  SELECT action,master_chain_id INTO master_action,master_chain FROM copy.master_copy_event
    WHERE master_copy_event_id=NEW.master_copy_event_id;
  IF master_action<>'OPEN_CSP' AND NOT EXISTS(SELECT 1 FROM copy.follower_chain_participation
      WHERE follower_account_id=NEW.follower_account_id AND master_chain_id=master_chain AND entry_participated=true) THEN
    RAISE EXCEPTION 'FOLLOWER_DID_NOT_PARTICIPATE_IN_CHAIN' USING ERRCODE='23514';
  END IF;
  IF master_action IN('EXPIRE_CSP','ASSIGN_STOCK','EXPIRE_CC','CALL_AWAY') THEN
    SELECT connection_id INTO broker_connection FROM trade.broker_activity_fact
      WHERE broker_activity_fact_id=NEW.follower_broker_activity_fact_id;
    IF broker_connection IS DISTINCT FROM NEW.follower_account_id THEN
      RAISE EXCEPTION 'FOLLOWER_LIFECYCLE_REQUIRES_OWN_BROKER_TRUTH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_disabled_follower_plan ON copy.follower_copy_event;
CREATE TRIGGER guard_disabled_follower_plan BEFORE INSERT ON copy.follower_copy_event
  FOR EACH ROW EXECUTE FUNCTION copy.guard_disabled_follower_plan();

INSERT INTO core.schema_migration(version,checksum)
VALUES('022_disabled_copy_engine_closure',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
