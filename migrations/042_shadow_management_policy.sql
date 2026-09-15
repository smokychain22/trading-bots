BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_shadow_management_policy_evidence (
  shadow_policy_evidence_id uuid PRIMARY KEY,
  management_input_snapshot_id uuid NOT NULL
    REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  observed_at timestamptz NOT NULL,
  lifecycle_state trade.lifecycle_state NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'theta-shadow-management-policy-v1'),
  feature_version text NOT NULL CHECK (feature_version = 'theta-profit-preservation-v1'),
  evidence_state text NOT NULL CHECK (evidence_state IN ('KNOWN','UNKNOWN','INVALID','NOT_APPLICABLE')),
  profit_state_json jsonb NOT NULL CHECK (jsonb_typeof(profit_state_json) = 'object'),
  action_comparisons_json jsonb NOT NULL CHECK (jsonb_typeof(action_comparisons_json) = 'array'),
  challenger_policies_json jsonb NOT NULL CHECK (jsonb_typeof(challenger_policies_json) = 'array'),
  strategy_switch_json jsonb NOT NULL CHECK (jsonb_typeof(strategy_switch_json) = 'object'),
  temporal_signals_json jsonb NOT NULL CHECK (jsonb_typeof(temporal_signals_json) = 'object'),
  comparison_complete boolean NOT NULL DEFAULT false CHECK (comparison_complete = false),
  shadow_preferred_action text CHECK (shadow_preferred_action IS NULL),
  production_policy_evidence_json jsonb CHECK (production_policy_evidence_json IS NULL),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  policy_readiness text NOT NULL CHECK (policy_readiness = 'NOT_EMPIRICALLY_PROMOTED'),
  unknown_reasons_json jsonb NOT NULL CHECK (jsonb_typeof(unknown_reasons_json) = 'array'),
  content_hash char(64) NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(management_input_snapshot_id, policy_version)
);

CREATE INDEX IF NOT EXISTS ix_shadow_management_policy_chain
  ON research.theta_shadow_management_policy_evidence(chain_id, observed_at DESC);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_shadow_management_policy_evidence;
CREATE TRIGGER reject_immutable_mutation
  BEFORE UPDATE OR DELETE ON research.theta_shadow_management_policy_evidence
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version, checksum)
VALUES('042_shadow_management_policy', repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
