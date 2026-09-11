BEGIN;

CREATE TABLE IF NOT EXISTS trade.management_decision (
  management_decision_id uuid PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  lifecycle_state_at_decision trade.lifecycle_state NOT NULL,
  route text NOT NULL CHECK (route IN ('SHORT_PUT','ASSIGNMENT_PENDING','STOCK_RECOVERY','COVERED_CALL')),
  selected_action text,
  hold_advantage numeric(24,10),
  valuations_json jsonb NOT NULL CHECK (jsonb_typeof(valuations_json) = 'array'),
  aegis_state core.aegis_action,
  execution_quality_acceptable boolean,
  fail_closed_reason text,
  policy_version text NOT NULL,
  model_versions_json jsonb NOT NULL CHECK (jsonb_typeof(model_versions_json) = 'object'),
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_management_decision_chain ON trade.management_decision(chain_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS trade.strategy_route (
  strategy_route_id uuid PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL UNIQUE REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  evaluated_at timestamptz NOT NULL,
  branch_eligibility_json jsonb NOT NULL CHECK (jsonb_typeof(branch_eligibility_json) = 'array'),
  selected_branch text CHECK (selected_branch IS NULL OR selected_branch IN ('THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D')),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade.shadow_opportunity (
  opportunity_id text PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  observed_at timestamptz NOT NULL,
  underlying text NOT NULL,
  contract_symbol text,
  strategy_branch text CHECK (strategy_branch IS NULL OR strategy_branch IN ('THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D')),
  ev_net numeric(24,8),
  tail_adjusted_ev numeric(24,8),
  return_per_capital_day numeric(24,12),
  capital_required numeric(24,8),
  uncertainty numeric(10,9) CHECK (uncertainty BETWEEN 0 AND 1),
  ownership_snapshot_id text,
  regime_snapshot_ref text,
  aegis_state core.aegis_action,
  recommended_quantity integer CHECK (recommended_quantity >= 0),
  execution_quality_acceptable boolean,
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED','WAIT','PASS','AEGIS_REJECTED','Q_ZERO','EXECUTION_REJECTED')),
  wait_reason text CHECK (wait_reason IS NULL OR wait_reason IN ('WAIT_PRICE','WAIT_VOL','WAIT_LIQUIDITY','WAIT_EVENT','WAIT_REGIME')),
  rejection_category text,
  reasons_json jsonb NOT NULL CHECK (jsonb_typeof(reasons_json) = 'array'),
  policy_version text NOT NULL,
  model_versions_json jsonb NOT NULL CHECK (jsonb_typeof(model_versions_json) = 'object'),
  eventual_outcome_known boolean NOT NULL DEFAULT false,
  eventual_realized_pnl numeric(24,8),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'WAIT') = (wait_reason IS NOT NULL)),
  CHECK (outcome <> 'Q_ZERO' OR recommended_quantity = 0),
  CHECK (eventual_outcome_known OR eventual_realized_pnl IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_shadow_opportunity_snapshot ON trade.shadow_opportunity(fusion_snapshot_id, observed_at);
CREATE INDEX IF NOT EXISTS ix_shadow_opportunity_underlying ON trade.shadow_opportunity(underlying, observed_at DESC);

CREATE TABLE IF NOT EXISTS trade.management_opportunity (
  entry_id text PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  lifecycle_state trade.lifecycle_state NOT NULL,
  route text NOT NULL CHECK (route IN ('SHORT_PUT','ASSIGNMENT_PENDING','STOCK_RECOVERY','COVERED_CALL','CLOSED','UNKNOWN')),
  alternatives_json jsonb NOT NULL CHECK (jsonb_typeof(alternatives_json) = 'array'),
  selected_label text,
  aegis_state core.aegis_action,
  execution_quality_acceptable boolean,
  unknown_input_reason_codes_json jsonb NOT NULL CHECK (jsonb_typeof(unknown_input_reason_codes_json) = 'array'),
  policy_version text NOT NULL,
  model_versions_json jsonb NOT NULL CHECK (jsonb_typeof(model_versions_json) = 'object'),
  fail_closed_reason text,
  eventual_outcome_known boolean NOT NULL DEFAULT false,
  eventual_realized_pnl numeric(24,8),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (eventual_outcome_known OR eventual_realized_pnl IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_management_opportunity_chain ON trade.management_opportunity(chain_id, observed_at DESC);

ALTER TABLE trade.decision ALTER COLUMN aegis_action DROP NOT NULL;
ALTER TABLE trade.decision ADD COLUMN IF NOT EXISTS runtime_selected_candidate_ref text;
ALTER TABLE trade.decision ADD COLUMN IF NOT EXISTS policy_version text;
ALTER TABLE trade.decision ADD COLUMN IF NOT EXISTS model_versions_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE trade.decision ADD COLUMN IF NOT EXISTS fail_closed_reason text;
ALTER TABLE trade.decision ADD COLUMN IF NOT EXISTS receipt_json jsonb;

CREATE TABLE IF NOT EXISTS trade.lifecycle_transition (
  lifecycle_transition_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  from_state trade.lifecycle_state NOT NULL,
  to_state trade.lifecycle_state NOT NULL,
  decision_id uuid REFERENCES trade.decision(decision_id),
  transitioned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_state <> to_state),
  UNIQUE(chain_id, from_state, to_state, transitioned_at)
);
CREATE INDEX IF NOT EXISTS ix_lifecycle_transition_chain ON trade.lifecycle_transition(chain_id, transitioned_at);

CREATE TABLE IF NOT EXISTS ops.scheduler_checkpoint (
  job_id text PRIMARY KEY,
  job_kind text NOT NULL,
  correlation_key text NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  status text NOT NULL CHECK (status IN ('PENDING','LEASED','COMPLETED','FAILED','ABANDONED')),
  last_error_code text,
  last_error_detail text,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'LEASED' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND last_heartbeat_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_scheduler_due ON ops.scheduler_checkpoint(status, next_run_at, lease_expires_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'management_decision', 'strategy_route', 'shadow_opportunity',
    'management_opportunity', 'lifecycle_transition'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version, checksum)
VALUES ('014_theta_runtime_persistence', repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
