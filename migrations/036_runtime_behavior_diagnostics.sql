BEGIN;

CREATE TABLE research.theta_runtime_behavior_diagnostic (
  diagnostic_id uuid PRIMARY KEY,
  scan_id uuid NOT NULL UNIQUE REFERENCES research.theta_shadow_scan_run(scan_id),
  observed_at timestamptz NOT NULL,
  contract_version text NOT NULL,
  wait_classification text NOT NULL CHECK(wait_classification IN (
    'ACTION_READY','HEALTHY_WAIT','NO_OPPORTUNITY','RISK_WAIT','QUOTE_WAIT','DATA_WAIT',
    'OVERSTRICT_POLICY_WAIT','POSSIBLE_LOGIC_PARALYSIS')),
  overtrading_state text NOT NULL CHECK(overtrading_state IN (
    'NO_NEW_ACTION','SINGLE_BOUNDED_ACTION','MULTIPLE_ACTION_PLANS_SAME_SCAN')),
  global_wait_earned boolean NOT NULL,
  consecutive_wait_cycles integer NOT NULL CHECK(consecutive_wait_cycles >= 0),
  last_broker_action_at timestamptz,
  seconds_since_last_broker_action numeric CHECK(seconds_since_last_broker_action IS NULL OR seconds_since_last_broker_action >= 0),
  candidate_count integer NOT NULL CHECK(candidate_count >= 0),
  feasible_candidate_count integer NOT NULL CHECK(feasible_candidate_count >= 0),
  selected_candidate_count integer NOT NULL CHECK(selected_candidate_count >= 0),
  hard_rejected_count integer NOT NULL CHECK(hard_rejected_count >= 0),
  soft_ranked_count integer NOT NULL CHECK(soft_ranked_count >= 0),
  data_insufficient_count integer NOT NULL CHECK(data_insufficient_count >= 0),
  quantity_zero_count integer NOT NULL CHECK(quantity_zero_count >= 0),
  aegis_veto_count integer NOT NULL CHECK(aegis_veto_count >= 0),
  near_miss_count integer NOT NULL CHECK(near_miss_count >= 0),
  action_plans_ready integer NOT NULL CHECK(action_plans_ready >= 0),
  provider_blockers_json jsonb NOT NULL CHECK(jsonb_typeof(provider_blockers_json)='array'),
  action_plan_blockers_json jsonb NOT NULL CHECK(jsonb_typeof(action_plan_blockers_json)='array'),
  reason_codes_json jsonb NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  threshold_policy_state text NOT NULL CHECK(threshold_policy_state='NO_EMPIRICAL_FREQUENCY_THRESHOLD'),
  diagnostic_json jsonb NOT NULL CHECK(jsonb_typeof(diagnostic_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_theta_runtime_behavior_diagnostic_observed
  ON research.theta_runtime_behavior_diagnostic(observed_at DESC,diagnostic_id);

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON research.theta_runtime_behavior_diagnostic
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('036_runtime_behavior_diagnostics',repeat('0',64));

COMMIT;
