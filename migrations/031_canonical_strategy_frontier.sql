BEGIN;

CREATE TABLE trade.canonical_strategy_frontier (
  frontier_id uuid PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL UNIQUE REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  observed_at timestamptz NOT NULL,
  contract_version text NOT NULL,
  strategy_version text NOT NULL,
  branches_considered_json jsonb NOT NULL CHECK(jsonb_typeof(branches_considered_json)='array'),
  branches_evaluated_json jsonb NOT NULL CHECK(jsonb_typeof(branches_evaluated_json)='array'),
  selected_branch text CHECK(selected_branch IS NULL OR selected_branch IN (
    'THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK','THETA_RECOVERY','THETA_CC')),
  selected_candidate_ref text,
  best_rejected_candidate_ref text,
  global_wait_earned boolean NOT NULL,
  empirical_economics_ready boolean NOT NULL CHECK(empirical_economics_ready=false),
  execution_authorized boolean NOT NULL CHECK(execution_authorized=false),
  frontier_json jsonb NOT NULL CHECK(jsonb_typeof(frontier_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_canonical_strategy_frontier_observed
  ON trade.canonical_strategy_frontier(observed_at,frontier_id);

ALTER TABLE research.theta_shadow_scan_run
  ADD COLUMN global_wait_earned boolean NOT NULL DEFAULT false,
  ADD COLUMN global_wait_evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK(jsonb_typeof(global_wait_evidence_json)='object');

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON trade.canonical_strategy_frontier
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('031_canonical_strategy_frontier',repeat('0',64));

COMMIT;
