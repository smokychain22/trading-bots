BEGIN;

CREATE TABLE market.optionomics_iv_session_observation (
  observation_id uuid PRIMARY KEY,
  underlying text NOT NULL CHECK(underlying ~ '^[A-Z0-9._-]{1,16}$'),
  session_date date NOT NULL,
  requested_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  provider_timestamp timestamptz,
  theta_first_observed_at timestamptz NOT NULL,
  atm_iv numeric NOT NULL CHECK(atm_iv >= 0 AND atm_iv <= 5),
  normalized_units text NOT NULL CHECK(normalized_units='DECIMAL_BY_CONSERVATIVE_RANGE_VALIDATION'),
  provider_units text NOT NULL,
  operation_alias text NOT NULL,
  contract_version text NOT NULL,
  evidence_authority text NOT NULL CHECK(evidence_authority='OPTIONOMICS_SESSION_RESEARCH'),
  response_hash char(64) NOT NULL CHECK(response_hash ~ '^[0-9a-f]{64}$'),
  request_parameters_json jsonb NOT NULL CHECK(jsonb_typeof(request_parameters_json)='object'),
  raw_payload_json jsonb NOT NULL,
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(underlying,session_date,response_hash),
  CHECK(requested_at <= retrieved_at),
  CHECK(theta_first_observed_at >= retrieved_at),
  CHECK(provider_timestamp IS NULL OR provider_timestamp <= theta_first_observed_at)
);

CREATE INDEX ix_optionomics_iv_session_history
  ON market.optionomics_iv_session_observation(underlying,session_date DESC,theta_first_observed_at DESC);

CREATE TABLE risk.aegis_iv_stress_assessment (
  assessment_id uuid PRIMARY KEY,
  underlying text NOT NULL CHECK(underlying ~ '^[A-Z0-9._-]{1,16}$'),
  decision_as_of timestamptz NOT NULL,
  current_observation_id uuid NOT NULL REFERENCES market.optionomics_iv_session_observation(observation_id),
  policy_version text NOT NULL,
  baseline_state text NOT NULL CHECK(baseline_state IN (
    'BASELINE_NOT_STARTED','BASELINE_ACCUMULATING','BASELINE_SUFFICIENT','BASELINE_INVALID',
    'CURRENT_OBSERVATION_STALE','CURRENT_OBSERVATION_INVALID','DETECTOR_READY','DETECTOR_PROVIDER_LIMITED'
  )),
  stress_iv_shock_detected boolean,
  current_iv numeric NOT NULL CHECK(current_iv >= 0 AND current_iv <= 5),
  baseline_median_iv numeric,
  baseline_mad_iv numeric,
  absolute_increase numeric,
  relative_increase numeric,
  robust_z numeric,
  raw_n integer NOT NULL CHECK(raw_n >= 0),
  session_n integer NOT NULL CHECK(session_n >= 0),
  baseline_observation_ids_json jsonb NOT NULL CHECK(jsonb_typeof(baseline_observation_ids_json)='array'),
  assessment_json jsonb NOT NULL CHECK(jsonb_typeof(assessment_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((baseline_state='DETECTOR_READY' AND stress_iv_shock_detected IS NOT NULL)
    OR (baseline_state<>'DETECTOR_READY' AND stress_iv_shock_detected IS NULL))
);

CREATE INDEX ix_aegis_iv_stress_latest
  ON risk.aegis_iv_stress_assessment(underlying,decision_as_of DESC);

CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.optionomics_iv_session_observation
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON risk.aegis_iv_stress_assessment
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('065_aegis_iv_stress_evidence',repeat('0',64));

COMMIT;
