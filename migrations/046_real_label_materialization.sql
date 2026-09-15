BEGIN;

ALTER TABLE research.theta_outcome_subject
  ADD COLUMN IF NOT EXISTS source_frontier_id uuid REFERENCES trade.canonical_strategy_frontier(frontier_id),
  ADD COLUMN IF NOT EXISTS source_decision_id uuid REFERENCES trade.decision(decision_id),
  ADD COLUMN IF NOT EXISTS comparison_group_id text,
  ADD COLUMN IF NOT EXISTS strategy_branch text,
  ADD COLUMN IF NOT EXISTS action_code text,
  ADD COLUMN IF NOT EXISTS subject_context_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(subject_context_json)='object');

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid='research.theta_outcome_subject'::regclass
    AND c.contype='c'
    AND pg_get_constraintdef(c.oid) LIKE '%num_nonnulls%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE research.theta_outcome_subject DROP CONSTRAINT %I',constraint_name);
  END IF;
END $$;

ALTER TABLE research.theta_outcome_subject
  ADD CONSTRAINT theta_outcome_subject_exactly_one_source CHECK(
    num_nonnulls(source_chain_decision_evidence_id,source_management_input_snapshot_id,
      source_chain_id,source_frontier_id,source_decision_id)=1
  );

CREATE INDEX IF NOT EXISTS ix_theta_outcome_subject_family_time
  ON research.theta_outcome_subject(label_type,decision_timestamp,outcome_subject_id);
CREATE INDEX IF NOT EXISTS ix_theta_outcome_subject_comparison_group
  ON research.theta_outcome_subject(comparison_group_id,label_type)
  WHERE comparison_group_id IS NOT NULL;

-- A restart may reevaluate a horizon before late observations arrive. Keep one
-- receipt for each subject/state/model tuple so repeated unresolved passes are
-- a no-op, while a later RESOLVED receipt remains possible.
CREATE UNIQUE INDEX IF NOT EXISTS ux_theta_outcome_resolution_receipt_state_model
  ON research.theta_outcome_resolution_receipt(
    outcome_subject_id,resolution_state,execution_model_version
  );

CREATE TABLE IF NOT EXISTS research.theta_policy_learning_record (
  policy_learning_record_id uuid PRIMARY KEY,
  outcome_subject_id uuid NOT NULL REFERENCES research.theta_outcome_subject(outcome_subject_id),
  resolved_outcome_label_id uuid NOT NULL REFERENCES research.theta_resolved_outcome_label(resolved_outcome_label_id),
  decision_timestamp timestamptz NOT NULL,
  label_available_at timestamptz NOT NULL CHECK(label_available_at>decision_timestamp),
  strategy_branch text,
  selected_action text,
  action_set_json jsonb NOT NULL CHECK(jsonb_typeof(action_set_json)='array'),
  pit_context_json jsonb NOT NULL CHECK(jsonb_typeof(pit_context_json)='object'),
  option_context_json jsonb NOT NULL CHECK(jsonb_typeof(option_context_json)='object'),
  portfolio_context_json jsonb NOT NULL CHECK(jsonb_typeof(portfolio_context_json)='object'),
  outcome_json jsonb NOT NULL CHECK(jsonb_typeof(outcome_json)='object'),
  provenance_class text NOT NULL CHECK(provenance_class IN ('BROKER_ACTUAL','MARKET_OBSERVED','REPLAY_OBSERVED','MODELED_RESEARCH')),
  tca_json jsonb NOT NULL CHECK(jsonb_typeof(tca_json)='object'),
  return_metrics_json jsonb NOT NULL CHECK(jsonb_typeof(return_metrics_json)='object'),
  return_cohort text CHECK(return_cohort IS NULL OR return_cohort IN ('VERY_SMALL','SMALL','MEDIUM','LARGE','VERY_LARGE')),
  win_rate_cohort text CHECK(win_rate_cohort IS NULL OR win_rate_cohort IN ('WR_40_50','WR_50_60','WR_60_70','WR_70_80','WR_80_PLUS')),
  cluster_ids_json jsonb NOT NULL CHECK(jsonb_typeof(cluster_ids_json)='object'),
  target_families_json jsonb NOT NULL CHECK(jsonb_typeof(target_families_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outcome_subject_id,resolved_outcome_label_id)
);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_policy_learning_record;
CREATE TRIGGER reject_immutable_mutation
  BEFORE UPDATE OR DELETE ON research.theta_policy_learning_record
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('046_real_label_materialization',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
