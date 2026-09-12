BEGIN;

-- Broker activity does not always include per-fill fees. Preserve UNKNOWN as
-- NULL instead of manufacturing a zero execution cost.
ALTER TABLE trade.fill ALTER COLUMN fees DROP NOT NULL;
ALTER TABLE trade.fill ALTER COLUMN fees DROP DEFAULT;

CREATE TABLE IF NOT EXISTS trade.candidate_set_evidence (
  candidate_set_id uuid PRIMARY KEY REFERENCES trade.candidate_set(candidate_set_id),
  decision_time timestamptz NOT NULL,
  universe_evaluated_json jsonb NOT NULL CHECK (jsonb_typeof(universe_evaluated_json)='array'),
  branches_considered_json jsonb NOT NULL CHECK (jsonb_typeof(branches_considered_json)='array'),
  counts_json jsonb NOT NULL CHECK (jsonb_typeof(counts_json)='object'),
  best_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  second_best_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  best_rejected_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  completeness_state text NOT NULL CHECK (completeness_state IN ('COMPLETE','PARTIAL','UNKNOWN')),
  missing_scope_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_scope_json)='array'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (best_candidate_id IS NULL OR best_candidate_id IS DISTINCT FROM second_best_candidate_id),
  CHECK (best_candidate_id IS NULL OR best_candidate_id IS DISTINCT FROM best_rejected_candidate_id)
);

CREATE TABLE IF NOT EXISTS trade.candidate_point_in_time_evidence (
  candidate_id uuid PRIMARY KEY REFERENCES trade.candidate(candidate_id),
  decision_id uuid REFERENCES trade.decision(decision_id),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  decision_time timestamptz NOT NULL,
  branch text NOT NULL,
  rank_at_decision integer CHECK(rank_at_decision IS NULL OR rank_at_decision > 0),
  selected boolean NOT NULL,
  hard_status text NOT NULL CHECK(hard_status IN ('FEASIBLE','HARD_VETO','INVALID','DATA_INSUFFICIENT')),
  soft_status text NOT NULL CHECK(soft_status IN ('RANKED','REJECTED','UNKNOWN')),
  rejection_reason text,
  contract_json jsonb NOT NULL CHECK(jsonb_typeof(contract_json)='object'),
  market_json jsonb NOT NULL CHECK(jsonb_typeof(market_json)='object'),
  volatility_json jsonb NOT NULL CHECK(jsonb_typeof(volatility_json)='object'),
  technical_json jsonb NOT NULL CHECK(jsonb_typeof(technical_json)='object'),
  event_json jsonb NOT NULL CHECK(jsonb_typeof(event_json)='object'),
  flow_json jsonb NOT NULL CHECK(jsonb_typeof(flow_json)='object'),
  ownership_json jsonb NOT NULL CHECK(jsonb_typeof(ownership_json)='object'),
  account_json jsonb NOT NULL CHECK(jsonb_typeof(account_json)='object'),
  portfolio_json jsonb NOT NULL CHECK(jsonb_typeof(portfolio_json)='object'),
  aegis_json jsonb NOT NULL CHECK(jsonb_typeof(aegis_json)='object'),
  execution_json jsonb NOT NULL CHECK(jsonb_typeof(execution_json)='object'),
  known_economics_json jsonb NOT NULL CHECK(jsonb_typeof(known_economics_json)='object'),
  unknown_economics_json jsonb NOT NULL CHECK(jsonb_typeof(unknown_economics_json)='array'),
  hard_blockers_json jsonb NOT NULL CHECK(jsonb_typeof(hard_blockers_json)='array'),
  soft_evidence_json jsonb NOT NULL CHECK(jsonb_typeof(soft_evidence_json)='array'),
  provider_provenance_json jsonb NOT NULL CHECK(jsonb_typeof(provider_provenance_json)='array'),
  strategy_version text NOT NULL,
  risk_version text NOT NULL,
  feature_version text NOT NULL,
  cost_model_version text NOT NULL,
  regime_version text NOT NULL,
  execution_model_version text NOT NULL,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_candidate_pit_decision ON trade.candidate_point_in_time_evidence(decision_time,candidate_id);

CREATE TABLE IF NOT EXISTS trade.global_wait_evidence (
  decision_id uuid PRIMARY KEY REFERENCES trade.decision(decision_id),
  candidate_set_id uuid REFERENCES trade.candidate_set(candidate_set_id),
  decision_time timestamptz NOT NULL,
  wait_reason text NOT NULL,
  underlyings_evaluated integer NOT NULL CHECK(underlyings_evaluated >= 0),
  contracts_evaluated integer NOT NULL CHECK(contracts_evaluated >= 0),
  branches_considered_json jsonb NOT NULL CHECK(jsonb_typeof(branches_considered_json)='array'),
  best_rejected_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  best_feasible_action text,
  blockers_json jsonb NOT NULL CHECK(jsonb_typeof(blockers_json)='array'),
  data_missing_json jsonb NOT NULL CHECK(jsonb_typeof(data_missing_json)='array'),
  search_proof_json jsonb NOT NULL CHECK(jsonb_typeof(search_proof_json)='object'),
  earned boolean NOT NULL,
  validation_violations_json jsonb NOT NULL CHECK(jsonb_typeof(validation_violations_json)='array'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market.execution_quote_observation (
  quote_observation_id uuid PRIMARY KEY,
  candidate_id uuid REFERENCES trade.candidate(candidate_id),
  management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  observation_role text NOT NULL CHECK(observation_role IN ('DECISION','SUBSEQUENT','BROKER_FILL')),
  observed_at timestamptz NOT NULL,
  provider_timestamp timestamptz,
  ingestion_timestamp timestamptz NOT NULL,
  source text NOT NULL,
  operation_alias text NOT NULL,
  feed text,
  contract_version text NOT NULL,
  bid numeric(24,8), ask numeric(24,8), bid_size numeric(24,8), ask_size numeric(24,8),
  proposed_limit numeric(24,8),
  data_quality text NOT NULL CHECK(data_quality IN ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED')),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(provider_timestamp IS NULL OR provider_timestamp <= observed_at),
  CHECK(ingestion_timestamp >= observed_at),
  CHECK(bid IS NULL OR ask IS NULL OR bid <= ask),
  CHECK(candidate_id IS NOT NULL OR management_input_snapshot_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_execution_quote_candidate ON market.execution_quote_observation(candidate_id,observed_at);

CREATE TABLE IF NOT EXISTS research.theta_outcome_label (
  outcome_label_id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK(subject_type IN ('CANDIDATE','MANAGED_EPISODE','WHOLE_CHAIN','EXECUTION')),
  subject_id uuid NOT NULL,
  label_available_at timestamptz NOT NULL,
  label_version text NOT NULL,
  censoring_state text NOT NULL CHECK(censoring_state IN ('RESOLVED','RIGHT_CENSORED','INVALIDATED')),
  whole_chain_net_pnl numeric(24,8), managed_episode_pnl numeric(24,8),
  return_on_secured_capital numeric(24,12), return_per_capital_day numeric(24,12),
  max_adverse_excursion numeric(24,8), max_favorable_excursion numeric(24,8),
  recovery_duration_days numeric(24,8), realized_execution_cost numeric(24,8),
  outcomes_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(outcomes_json)='object'),
  provenance_json jsonb NOT NULL CHECK(jsonb_typeof(provenance_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.theta_counterfactual_outcome (
  counterfactual_id uuid PRIMARY KEY,
  source_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  source_management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  alternative_branch text,
  alternative_action text,
  state text NOT NULL DEFAULT 'BLOCKED_ON_DATA' CHECK(state='BLOCKED_ON_DATA'),
  blocked_reason text NOT NULL,
  method_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_candidate_id IS NOT NULL OR source_management_input_snapshot_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ops.decision_trigger_evidence (
  decision_trigger_id uuid PRIMARY KEY,
  trigger_type text NOT NULL CHECK(trigger_type IN ('SCHEDULED','BROKER_FILL','PARTIAL_FILL','ORDER_STATE_CHANGE','ASSIGNMENT_EXPIRY','QUOTE_CHANGE','PORTFOLIO_RISK_CHANGE','EVENT_STATE_CHANGE','PROVIDER_RECOVERY')),
  correlation_key text NOT NULL,
  debounce_bucket timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  source_event_hash char(64) NOT NULL CHECK(source_event_hash ~ '^[0-9a-f]{64}$'),
  strategy_version text NOT NULL,
  trigger_payload_json jsonb NOT NULL CHECK(jsonb_typeof(trigger_payload_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trigger_type,correlation_key,debounce_bucket,source_event_hash)
);

CREATE TABLE IF NOT EXISTS trade.decision_invalidation_snapshot (
  decision_invalidation_snapshot_id uuid PRIMARY KEY,
  decision_id uuid REFERENCES trade.decision(decision_id),
  management_input_snapshot_id uuid REFERENCES trade.management_input_snapshot(management_input_snapshot_id),
  strategy_version text NOT NULL,
  observed_at timestamptz NOT NULL,
  triggers_json jsonb NOT NULL CHECK(jsonb_typeof(triggers_json)='array'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(decision_id IS NOT NULL OR management_input_snapshot_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS research.theta_dataset_export (
  dataset_export_id uuid PRIMARY KEY,
  source_window_start timestamptz NOT NULL,
  source_window_end timestamptz NOT NULL,
  exported_at timestamptz NOT NULL,
  schema_version text NOT NULL,
  feature_set_version text NOT NULL,
  strategy_versions_json jsonb NOT NULL CHECK(jsonb_typeof(strategy_versions_json)='array'),
  row_counts_json jsonb NOT NULL CHECK(jsonb_typeof(row_counts_json)='object'),
  dataset_hash char(64) NOT NULL UNIQUE CHECK(dataset_hash ~ '^[0-9a-f]{64}$'),
  CHECK(source_window_end >= source_window_start)
);

DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['candidate_set_evidence','candidate_point_in_time_evidence','global_wait_evidence','decision_invalidation_snapshot'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', target);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()', target);
  END LOOP;
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON market.execution_quote_observation;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.execution_quote_observation FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON ops.decision_trigger_evidence;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.decision_trigger_evidence FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  FOREACH target IN ARRAY ARRAY['theta_outcome_label','theta_counterfactual_outcome','theta_dataset_export'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.%I', target);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()', target);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('018_point_in_time_evidence_pipeline',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
