BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_outcome_subject (
  outcome_subject_id uuid PRIMARY KEY,
  source_chain_decision_evidence_id uuid REFERENCES research.theta_option_chain_decision_evidence(chain_decision_evidence_id),
  source_management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  source_chain_id uuid REFERENCES trade.economic_chain(chain_id),
  subject_id text NOT NULL CHECK(length(btrim(subject_id)) > 0),
  label_type text NOT NULL CHECK(label_type IN (
    'SELECTED_ACTION_OUTCOME','WAIT_OUTCOME','SELECTED_CONTRACT_OUTCOME','NEIGHBOR_STRIKE_OUTCOME',
    'OTHER_EXPIRATION_OUTCOME','OTHER_STRUCTURE_OUTCOME','MANAGEMENT_ACTION_OUTCOME',
    'MANAGEMENT_ALTERNATIVE_OUTCOME','STRATEGY_OUTCOME','WHOLE_CHAIN_OUTCOME',
    'ACTION_REGRET','CONTRACT_REGRET','STRATEGY_REGRET')),
  decision_timestamp timestamptz NOT NULL,
  feature_snapshot_hash char(64) NOT NULL CHECK(feature_snapshot_hash ~ '^[0-9a-f]{64}$'),
  candidate_universe_hash char(64) NOT NULL CHECK(candidate_universe_hash ~ '^[0-9a-f]{64}$'),
  exact_contract_id text,
  strategy_version text NOT NULL,
  horizon_id text NOT NULL,
  horizon_closes_at timestamptz NOT NULL CHECK(horizon_closes_at > decision_timestamp),
  resolver_contract_version text NOT NULL CHECK(resolver_contract_version='theta-outcome-resolution-v1'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(source_chain_decision_evidence_id,source_management_input_snapshot_id,source_chain_id)=1),
  CONSTRAINT theta_outcome_subject_decision_identity UNIQUE(subject_id,label_type,decision_timestamp,horizon_id,resolver_contract_version)
);

CREATE TABLE IF NOT EXISTS research.theta_outcome_observation (
  outcome_observation_id uuid PRIMARY KEY,
  outcome_subject_id uuid NOT NULL REFERENCES research.theta_outcome_subject(outcome_subject_id),
  observed_at timestamptz NOT NULL,
  provider_timestamp timestamptz,
  received_at timestamptz NOT NULL CHECK(received_at >= observed_at),
  source text NOT NULL,
  provenance_class text NOT NULL CHECK(provenance_class IN ('BROKER_ACTUAL','MARKET_OBSERVED','REPLAY_OBSERVED','MODELED_RESEARCH')),
  completeness text NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL','INVALID')),
  reason_codes_json jsonb NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  exact_contract_id text,
  bid numeric(24,8), ask numeric(24,8), underlying_spot numeric(24,8), economic_pnl numeric(24,8),
  fees numeric(24,8), slippage numeric(24,8), capital_days numeric(24,12),
  lifecycle_state text, terminal boolean NOT NULL DEFAULT false,
  observation_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(observation_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(provider_timestamp IS NULL OR provider_timestamp <= observed_at),
  CHECK(bid IS NULL OR ask IS NULL OR bid <= ask)
);

CREATE INDEX IF NOT EXISTS ix_theta_outcome_observation_subject_time
  ON research.theta_outcome_observation(outcome_subject_id,observed_at);

CREATE TABLE IF NOT EXISTS research.theta_outcome_resolution_receipt (
  outcome_resolution_receipt_id uuid PRIMARY KEY,
  outcome_subject_id uuid NOT NULL REFERENCES research.theta_outcome_subject(outcome_subject_id),
  resolution_state text NOT NULL CHECK(resolution_state IN ('RESOLVED','PENDING','UNRESOLVED','INVALID')),
  provenance_class text NOT NULL CHECK(provenance_class IN ('BROKER_ACTUAL','MARKET_OBSERVED','REPLAY_OBSERVED','MODELED_RESEARCH','UNRESOLVED','INVALID')),
  completeness text NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL','UNRESOLVED','INVALID')),
  decision_timestamp timestamptz NOT NULL,
  outcome_observation_start timestamptz,
  outcome_observation_end timestamptz,
  label_available_at timestamptz,
  resolution_timestamp timestamptz NOT NULL,
  execution_model_class text NOT NULL CHECK(execution_model_class IN ('BROKER_ACTUAL','MARKET_MARK','MODELED_RESEARCH','NONE')),
  execution_model_version text NOT NULL,
  receipt_json jsonb NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(label_available_at IS NULL OR label_available_at > decision_timestamp),
  CHECK(outcome_observation_start IS NULL OR outcome_observation_start > decision_timestamp),
  CHECK(outcome_observation_end IS NULL OR outcome_observation_end >= outcome_observation_start),
  CHECK(NOT(provenance_class='BROKER_ACTUAL' AND execution_model_class<>'BROKER_ACTUAL')),
  CHECK(NOT(provenance_class='MODELED_RESEARCH' AND execution_model_class='BROKER_ACTUAL'))
);

CREATE TABLE IF NOT EXISTS research.theta_resolved_outcome_label (
  resolved_outcome_label_id uuid PRIMARY KEY,
  outcome_subject_id uuid NOT NULL REFERENCES research.theta_outcome_subject(outcome_subject_id),
  outcome_resolution_receipt_id uuid NOT NULL UNIQUE REFERENCES research.theta_outcome_resolution_receipt(outcome_resolution_receipt_id),
  label_type text NOT NULL,
  provenance_class text NOT NULL CHECK(provenance_class IN ('BROKER_ACTUAL','MARKET_OBSERVED','REPLAY_OBSERVED','MODELED_RESEARCH')),
  completeness text NOT NULL CHECK(completeness IN ('COMPLETE','PARTIAL')),
  decision_timestamp timestamptz NOT NULL,
  label_available_at timestamptz NOT NULL CHECK(label_available_at > decision_timestamp),
  label_version text NOT NULL,
  market_mark_json jsonb NOT NULL CHECK(jsonb_typeof(market_mark_json)='object'),
  modeled_execution_json jsonb NOT NULL CHECK(jsonb_typeof(modeled_execution_json)='object'),
  path_statistics_json jsonb NOT NULL CHECK(jsonb_typeof(path_statistics_json)='object'),
  tca_json jsonb NOT NULL CHECK(jsonb_typeof(tca_json)='object'),
  outcome_json jsonb NOT NULL CHECK(jsonb_typeof(outcome_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outcome_subject_id,label_version)
);

CREATE TABLE IF NOT EXISTS research.theta_policy_challenger_evaluation (
  policy_challenger_evaluation_id uuid PRIMARY KEY,
  policy_id text NOT NULL,
  policy_version text NOT NULL,
  evaluation_version text NOT NULL CHECK(evaluation_version='theta-policy-challenger-evaluation-v1'),
  dataset_hash char(64) NOT NULL CHECK(dataset_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('EVALUABLE','NOT_EVALUABLE','INSUFFICIENT_SAMPLE')),
  raw_n integer NOT NULL CHECK(raw_n>=0),
  effective_cluster_n integer NOT NULL CHECK(effective_cluster_n>=0 AND effective_cluster_n<=raw_n),
  metrics_json jsonb NOT NULL CHECK(jsonb_typeof(metrics_json)='object'),
  promoted boolean NOT NULL DEFAULT false CHECK(promoted=false),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'theta_outcome_subject','theta_outcome_observation','theta_outcome_resolution_receipt',
    'theta_resolved_outcome_label','theta_policy_challenger_evaluation'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.%I',table_name);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',table_name);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('044_resolved_outcome_engine',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
