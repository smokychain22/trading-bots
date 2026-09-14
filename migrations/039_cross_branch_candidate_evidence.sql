BEGIN;

-- The canonical frontier already preserves every branch as immutable JSON.
-- These relational projections make every branch and candidate queryable for
-- PIT research without forcing multi-leg or stock actions into the legacy
-- single-option trade.candidate shape.
CREATE TABLE trade.canonical_strategy_branch_evidence (
  branch_evidence_id uuid PRIMARY KEY,
  frontier_id uuid NOT NULL REFERENCES trade.canonical_strategy_frontier(frontier_id),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  branch core.strategy_branch NOT NULL,
  strategy_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('RESEARCH_ONLY','SHADOW')),
  applicable boolean NOT NULL,
  evaluated boolean NOT NULL,
  evaluation_state text NOT NULL CHECK(evaluation_state IN ('EVALUATED','NOT_APPLICABLE','BLOCKED_MISSING_INPUT')),
  candidate_count integer NOT NULL CHECK(candidate_count >= 0),
  mechanically_rejected integer NOT NULL CHECK(mechanically_rejected >= 0),
  hard_vetoed integer NOT NULL CHECK(hard_vetoed >= 0),
  soft_ranked integer NOT NULL CHECK(soft_ranked >= 0),
  data_insufficient integer NOT NULL CHECK(data_insufficient >= 0),
  enumeration_truncated boolean NOT NULL,
  best_candidate_ref text,
  second_best_candidate_ref text,
  best_rejected_candidate_ref text,
  route_reasons_json jsonb NOT NULL CHECK(jsonb_typeof(route_reasons_json)='array'),
  empirical_economics_ready boolean NOT NULL CHECK(empirical_economics_ready=false),
  execution_authorized boolean NOT NULL CONSTRAINT canonical_candidate_execution_locked CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(frontier_id,branch),
  CHECK((evaluation_state='NOT_APPLICABLE') = (applicable=false)),
  CHECK(candidate_count >= soft_ranked)
);

CREATE INDEX ix_canonical_branch_evidence_time
  ON trade.canonical_strategy_branch_evidence(fusion_snapshot_id,branch);

CREATE TABLE trade.canonical_strategy_candidate_evidence (
  candidate_evidence_id uuid PRIMARY KEY,
  branch_evidence_id uuid NOT NULL REFERENCES trade.canonical_strategy_branch_evidence(branch_evidence_id),
  frontier_id uuid NOT NULL REFERENCES trade.canonical_strategy_frontier(frontier_id),
  candidate_ref text NOT NULL,
  branch core.strategy_branch NOT NULL,
  action text NOT NULL CHECK(action IN ('OPEN_CSP','OPEN_DEFINED_RISK','RECOVERY_WAIT','SELL_STOCK','SELL_CC')),
  underlying text NOT NULL,
  rank_at_decision integer CHECK(rank_at_decision IS NULL OR rank_at_decision > 0),
  selected boolean NOT NULL,
  legs_json jsonb NOT NULL CHECK(jsonb_typeof(legs_json)='array'),
  dte integer CHECK(dte IS NULL OR dte >= 0),
  delta numeric,
  moneyness numeric,
  spread_pct numeric CHECK(spread_pct IS NULL OR spread_pct >= 0),
  liquidity_json jsonb NOT NULL CHECK(jsonb_typeof(liquidity_json)='object'),
  economics_json jsonb NOT NULL CHECK(jsonb_typeof(economics_json)='object'),
  assignment_capacity_qty numeric CHECK(assignment_capacity_qty IS NULL OR assignment_capacity_qty >= 0),
  hard_blockers_json jsonb NOT NULL CHECK(jsonb_typeof(hard_blockers_json)='array'),
  soft_evidence_json jsonb NOT NULL CHECK(jsonb_typeof(soft_evidence_json)='array'),
  unknown_evidence_json jsonb NOT NULL CHECK(jsonb_typeof(unknown_evidence_json)='array'),
  structurally_feasible boolean NOT NULL,
  risk_feasible boolean NOT NULL,
  quantity integer NOT NULL CHECK(quantity >= 0),
  binding_constraint text NOT NULL,
  sizing_reasons_json jsonb NOT NULL CHECK(jsonb_typeof(sizing_reasons_json)='array'),
  execution_authorized boolean NOT NULL CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(frontier_id,candidate_ref),
  CONSTRAINT canonical_candidate_max_two_legs CHECK(jsonb_array_length(legs_json) <= 2),
  CONSTRAINT canonical_candidate_csp_one_leg CHECK(action <> 'OPEN_CSP' OR jsonb_array_length(legs_json)=1),
  CONSTRAINT canonical_candidate_defined_risk_two_legs CHECK(action <> 'OPEN_DEFINED_RISK' OR jsonb_array_length(legs_json)=2),
  CONSTRAINT canonical_candidate_stock_action_no_legs CHECK(action NOT IN ('RECOVERY_WAIT','SELL_STOCK') OR jsonb_array_length(legs_json)=0),
  CONSTRAINT canonical_candidate_selected_feasible CHECK(NOT selected OR (structurally_feasible AND risk_feasible AND (quantity > 0 OR action='RECOVERY_WAIT'))),
  CONSTRAINT canonical_candidate_recovery_wait_zero CHECK(action <> 'RECOVERY_WAIT' OR quantity=0)
);

CREATE INDEX ix_canonical_candidate_evidence_branch_rank
  ON trade.canonical_strategy_candidate_evidence(branch,rank_at_decision,candidate_ref);

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON trade.canonical_strategy_branch_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON trade.canonical_strategy_candidate_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('039_cross_branch_candidate_evidence',repeat('0',64));

COMMIT;
