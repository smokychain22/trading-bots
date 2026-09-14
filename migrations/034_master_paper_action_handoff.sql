BEGIN;

ALTER TABLE ops.runtime_worker_status DROP CONSTRAINT IF EXISTS runtime_worker_status_execution_gate_check;
ALTER TABLE ops.runtime_worker_status ADD CONSTRAINT runtime_worker_status_execution_gate_check
  CHECK(execution_gate IN ('LOCKED','EXTERNAL_QUOTE_BLOCKER','ACTIVE'));

CREATE TABLE trade.master_paper_action_plan (
  action_plan_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE REFERENCES trade.decision(decision_id),
  execution_account_id uuid NOT NULL REFERENCES trade.execution_account(execution_account_id),
  plan_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('READY','CLAIMED','WAITING_GATE','SUBMITTED','TERMINAL','QUARANTINED')),
  plan_json jsonb NOT NULL,
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  not_before timestamptz NOT NULL,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_blockers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK((status='CLAIMED')=(claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE INDEX ix_master_paper_action_plan_due ON trade.master_paper_action_plan(execution_account_id,not_before)
  WHERE status IN ('READY','WAITING_GATE','CLAIMED');

CREATE TABLE trade.master_paper_action_plan_event (
  action_plan_event_id uuid PRIMARY KEY,
  action_plan_id uuid NOT NULL REFERENCES trade.master_paper_action_plan(action_plan_id),
  state text NOT NULL CHECK(state IN ('READY','CLAIMED','WAITING_GATE','SUBMITTED','TERMINAL','QUARANTINED')),
  event_time timestamptz NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_master_paper_action_plan_event ON trade.master_paper_action_plan_event(action_plan_id,event_time);
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.master_paper_action_plan_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('034_master_paper_action_handoff',repeat('0',64));

COMMIT;
