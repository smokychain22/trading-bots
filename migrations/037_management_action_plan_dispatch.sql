BEGIN;

ALTER TABLE trade.master_paper_action_plan
  DROP CONSTRAINT IF EXISTS master_paper_action_plan_decision_id_key;

ALTER TABLE trade.master_paper_action_plan
  ADD COLUMN authority_kind text NOT NULL DEFAULT 'NEW_RISK',
  ADD COLUMN management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  ADD COLUMN management_action_frontier_id uuid REFERENCES trade.management_action_frontier(management_action_frontier_id),
  ADD COLUMN action_group_id uuid,
  ADD COLUMN leg_sequence integer NOT NULL DEFAULT 1,
  ADD COLUMN depends_on_action_plan_id uuid REFERENCES trade.master_paper_action_plan(action_plan_id),
  ADD COLUMN execution_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id);

UPDATE trade.master_paper_action_plan
SET action_group_id=action_plan_id,
    status=CASE WHEN status IN ('READY','CLAIMED','WAITING_GATE') THEN 'QUARANTINED' ELSE status END,
    last_blockers_json=CASE WHEN status IN ('READY','CLAIMED','WAITING_GATE')
      THEN '["ACTION_PLAN_CONTRACT_SUPERSEDED"]'::jsonb ELSE last_blockers_json END,
    claimed_by=NULL,claimed_at=NULL,claim_expires_at=NULL,
    updated_at=now()
WHERE action_group_id IS NULL;

ALTER TABLE trade.master_paper_action_plan
  ALTER COLUMN action_group_id SET NOT NULL,
  ADD CONSTRAINT master_paper_action_plan_authority_kind_check
    CHECK(authority_kind IN ('NEW_RISK','MANAGEMENT')),
  ADD CONSTRAINT master_paper_action_plan_authority_shape_check CHECK(
    (authority_kind='NEW_RISK' AND management_input_snapshot_id IS NULL AND management_action_frontier_id IS NULL)
    OR
    (authority_kind='MANAGEMENT' AND management_input_snapshot_id IS NOT NULL AND management_action_frontier_id IS NOT NULL)
  ),
  ADD CONSTRAINT master_paper_action_plan_leg_sequence_check CHECK(leg_sequence > 0),
  ADD CONSTRAINT master_paper_action_plan_dependency_shape_check CHECK(
    (leg_sequence=1 AND depends_on_action_plan_id IS NULL)
    OR
    (leg_sequence>1 AND depends_on_action_plan_id IS NOT NULL)
  ),
  ADD CONSTRAINT master_paper_action_plan_no_self_dependency_check CHECK(
    depends_on_action_plan_id IS NULL OR depends_on_action_plan_id<>action_plan_id
  ),
  ADD CONSTRAINT master_paper_action_plan_decision_group_leg_key UNIQUE(decision_id,action_group_id,leg_sequence),
  ADD CONSTRAINT master_paper_action_plan_frontier_group_leg_key UNIQUE(management_action_frontier_id,action_group_id,leg_sequence),
  ADD CONSTRAINT master_paper_action_plan_execution_intent_key UNIQUE(execution_order_intent_id);

CREATE INDEX ix_master_paper_action_plan_dependency
  ON trade.master_paper_action_plan(depends_on_action_plan_id)
  WHERE depends_on_action_plan_id IS NOT NULL;

INSERT INTO core.schema_migration(version,checksum)
VALUES('037_management_action_plan_dispatch',repeat('0',64));

COMMIT;
