BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_option_chain_decision_evidence (
  chain_decision_evidence_id uuid PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL UNIQUE REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  observed_at timestamptz NOT NULL,
  underlying text NOT NULL CHECK (length(btrim(underlying)) > 0),
  contract_version text NOT NULL CHECK (contract_version = 'theta-options-chain-decision-v1'),
  liquidity_policy_version text NOT NULL,
  chain_snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(chain_snapshot_json) = 'object'),
  expiration_frontier_json jsonb NOT NULL CHECK (jsonb_typeof(expiration_frontier_json) = 'array'),
  strike_delta_frontier_json jsonb NOT NULL CHECK (jsonb_typeof(strike_delta_frontier_json) = 'array'),
  structure_comparator_json jsonb NOT NULL CHECK (jsonb_typeof(structure_comparator_json) = 'array'),
  optionomics_attachments_json jsonb NOT NULL CHECK (jsonb_typeof(optionomics_attachments_json) = 'array'),
  contract_selection_receipt_json jsonb NOT NULL CHECK (jsonb_typeof(contract_selection_receipt_json) = 'object'),
  counterfactual_label_contract_json jsonb NOT NULL CHECK (jsonb_typeof(counterfactual_label_contract_json) = 'object'),
  empirical_economics_ready boolean NOT NULL DEFAULT false CHECK (empirical_economics_ready = false),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  content_hash char(64) NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_theta_option_chain_decision_underlying_time
  ON research.theta_option_chain_decision_evidence(underlying, observed_at DESC);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_option_chain_decision_evidence;
CREATE TRIGGER reject_immutable_mutation
  BEFORE UPDATE OR DELETE ON research.theta_option_chain_decision_evidence
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version, checksum)
VALUES('043_options_chain_decision_intelligence', repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
