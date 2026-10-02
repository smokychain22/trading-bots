BEGIN;

-- ACTION_PLAN_INTEGRITY. A published master Paper action plan has an IMMUTABLE ECONOMIC PAYLOAD (identity, economics,
-- denormalized economic columns, sealed content hash) and MUTABLE OPERATIONAL METADATA (status, claim fields, blockers,
-- not_before, updated_at, the linked order intent). This trigger enforces that split in the database so a plan approved
-- under one set of economics cannot be silently rewritten before execution, whoever holds a write connection.
-- Forward-only and idempotent. The runtime also verifies the hash at claim and before submit (application layer).

CREATE OR REPLACE FUNCTION trade.reject_master_paper_action_plan_economic_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action_plan_id IS DISTINCT FROM OLD.action_plan_id
    OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
    OR NEW.execution_account_id IS DISTINCT FROM OLD.execution_account_id
    OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
    OR NEW.plan_json IS DISTINCT FROM OLD.plan_json
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.execution_tier IS DISTINCT FROM OLD.execution_tier
    OR NEW.canonical_quantity IS DISTINCT FROM OLD.canonical_quantity
    OR NEW.paper_evidence_quantity IS DISTINCT FROM OLD.paper_evidence_quantity
    OR NEW.empirical_economics_ready IS DISTINCT FROM OLD.empirical_economics_ready
    OR NEW.expected_after_cost_ev IS DISTINCT FROM OLD.expected_after_cost_ev
    OR NEW.authority_kind IS DISTINCT FROM OLD.authority_kind
    OR NEW.management_input_snapshot_id IS DISTINCT FROM OLD.management_input_snapshot_id
    OR NEW.management_action_frontier_id IS DISTINCT FROM OLD.management_action_frontier_id
    OR NEW.action_group_id IS DISTINCT FROM OLD.action_group_id
    OR NEW.leg_sequence IS DISTINCT FROM OLD.leg_sequence
    OR NEW.depends_on_action_plan_id IS DISTINCT FROM OLD.depends_on_action_plan_id THEN
    RAISE EXCEPTION 'PLAN_INTEGRITY_MISMATCH: economic payload of master_paper_action_plan % is immutable', OLD.action_plan_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- The order intent link may be set once and never re-pointed.
  IF OLD.execution_order_intent_id IS NOT NULL AND NEW.execution_order_intent_id IS DISTINCT FROM OLD.execution_order_intent_id THEN
    RAISE EXCEPTION 'PLAN_INTEGRITY_MISMATCH: execution_order_intent_id of master_paper_action_plan % is immutable once set', OLD.action_plan_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Terminal states are final: a finished or quarantined plan can never be resurrected.
  IF OLD.status IN ('TERMINAL', 'QUARANTINED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'PLAN_INTEGRITY_MISMATCH: master_paper_action_plan % is %, a terminal state', OLD.action_plan_id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_master_paper_action_plan_economic_mutation ON trade.master_paper_action_plan;
CREATE TRIGGER reject_master_paper_action_plan_economic_mutation
  BEFORE UPDATE ON trade.master_paper_action_plan
  FOR EACH ROW EXECUTE FUNCTION trade.reject_master_paper_action_plan_economic_mutation();

-- RECOVERY_ACTION_RACE / MGMT-CROSS-CYCLE-DUP at the database boundary: at most one pre-submit management plan per chain and
-- leg position. Two simultaneous publications for one chain (for example SELL_STOCK and SELL_CC) cannot both become
-- READY/CLAIMED/WAITING_GATE. SUBMITTED plans are excluded: from then on the order intent in-flight guard owns the chain.
-- Pre-existing duplicates would make the unique index fail and leave the database unmigrated. Keep the newest pre-submit
-- management plan per chain and leg and quarantine the older ones (a quarantined pre-submit plan can never execute). Safe and
-- idempotent: on a clean database this updates nothing.
WITH ranked AS (
  SELECT action_plan_id,
         row_number() OVER (PARTITION BY plan_json ->> 'chainId', leg_sequence ORDER BY created_at DESC, action_plan_id DESC) AS rn
  FROM trade.master_paper_action_plan
  WHERE authority_kind = 'MANAGEMENT' AND status IN ('READY', 'CLAIMED', 'WAITING_GATE')
)
UPDATE trade.master_paper_action_plan p
   SET status = 'QUARANTINED', last_blockers_json = '["MIGRATION_068_DUPLICATE_PRESUBMIT_PLAN"]'::jsonb,
       claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL, updated_at = now()
  FROM ranked
 WHERE p.action_plan_id = ranked.action_plan_id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_master_paper_action_plan_management_chain_leg_presubmit
  ON trade.master_paper_action_plan ((plan_json ->> 'chainId'), leg_sequence)
  WHERE authority_kind = 'MANAGEMENT' AND status IN ('READY', 'CLAIMED', 'WAITING_GATE');

INSERT INTO core.schema_migration(version, checksum)
VALUES('068_action_plan_integrity', repeat('0',64))
ON CONFLICT DO NOTHING;

COMMIT;
