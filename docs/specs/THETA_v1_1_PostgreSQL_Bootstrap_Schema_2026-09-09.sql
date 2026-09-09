-- THETA v1.1 PostgreSQL Bootstrap Schema
-- Canonical parents: THETA v1 TRD v1.1 FINAL + PRD v1.1 FINAL
-- Runtime providers: Alpaca + Optionomics only
-- This bootstrap intentionally favors standard PostgreSQL; application migrations become authoritative after bootstrap.
-- v1.1 completeness patch:
-- - explicit sizing-decision lineage (no hidden quantity floor)
-- - point-in-time correlation and exposure-cluster risk evidence
-- - Optionomics feature-family contract versioning (no guessed JSON paths)
-- - Greek unit-basis/normalization metadata
-- - canonical latest-feature / portfolio-risk / correlation read views
-- - validation fixtures for short-option P&L sign and signed Greek normalization

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS research;
CREATE SCHEMA IF NOT EXISTS trade;
CREATE SCHEMA IF NOT EXISTS risk;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS analytics;

DO $$ BEGIN CREATE TYPE core.provider_code AS ENUM ('ALPACA','OPTIONOMICS'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.operating_mode AS ENUM ('RESEARCH','SHADOW','PAPER','LIVE_SMALL','LIVE','SAFE_HOLD','QUARANTINED','KILLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.data_quality AS ENUM ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.aegis_action AS ENUM ('ALLOW_FULL','ALLOW_REDUCED','DEFINED_RISK_ONLY','HOLD_ONLY','HARD_VETO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.alert_severity AS ENUM ('INFO','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.option_type AS ENUM ('CALL','PUT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE core.strategy_branch AS ENUM ('THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK','THETA_RECOVERY','THETA_CC'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS iam.workspace (
  workspace_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS iam.app_user (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, display_name text, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_email_ci ON iam.app_user(lower(email));
CREATE TABLE IF NOT EXISTS iam.workspace_member (
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES iam.app_user(user_id) ON DELETE CASCADE,
  role_code text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,user_id,role_code)
);
CREATE TABLE IF NOT EXISTS iam.auth_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES iam.app_user(user_id), issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, token_hash text, auth_context_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS iam.step_up_auth_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), user_id uuid NOT NULL REFERENCES iam.app_user(user_id), sensitive_action text NOT NULL, method text NOT NULL, result text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, auth_context_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS core.provider_connection (
  provider_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), provider_code core.provider_code NOT NULL, environment text NOT NULL, secret_ref text NOT NULL, masked_label text, status text NOT NULL, connected_at timestamptz, last_verified_at timestamptz, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(workspace_id, provider_code, environment)
);
CREATE TABLE IF NOT EXISTS core.provider_capability (
  provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id) ON DELETE CASCADE, capability_code text NOT NULL, entitlement text, status text NOT NULL, checked_at timestamptz NOT NULL, details_json jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(provider_connection_id, capability_code)
);
CREATE TABLE IF NOT EXISTS core.provider_operation_registry (
  provider_code core.provider_code NOT NULL, operation_alias text NOT NULL, method text NOT NULL, path_or_operation_id text NOT NULL, contract_version text NOT NULL, active_from timestamptz NOT NULL DEFAULT now(), active_to timestamptz, notes text, PRIMARY KEY(provider_code, operation_alias, contract_version)
);
CREATE TABLE IF NOT EXISTS core.provider_request (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id), operation_alias text NOT NULL, requested_at timestamptz NOT NULL, responded_at timestamptz, status_code int, latency_ms int, rate_limit_json jsonb, payload_hash char(64), raw_payload_ref text, error_code text, request_meta_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_provider_request_time ON core.provider_request(provider_connection_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_provider_request_error ON core.provider_request(provider_connection_id, requested_at DESC) WHERE status_code >= 400;

CREATE TABLE IF NOT EXISTS core.trading_account (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id), provider_account_id text NOT NULL, base_currency text NOT NULL DEFAULT 'USD', environment text NOT NULL, options_level int, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_connection_id, provider_account_id)
);
CREATE TABLE IF NOT EXISTS trade.account_snapshot (
  account_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES core.trading_account(account_id), equity numeric(24,8), cash numeric(24,8), buying_power numeric(24,8), options_buying_power numeric(24,8), options_level int, as_of timestamptz NOT NULL, retrieved_at timestamptz NOT NULL, provider_request_id bigint REFERENCES core.provider_request(request_id), payload_hash char(64)
);
CREATE INDEX IF NOT EXISTS ix_account_snapshot_latest ON trade.account_snapshot(account_id,as_of DESC);

CREATE TABLE IF NOT EXISTS core.strategy_version (
  strategy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), semantic_version text NOT NULL UNIQUE, config_json jsonb NOT NULL, config_hash char(64) NOT NULL UNIQUE, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS core.risk_limit_version (
  risk_limit_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), semantic_version text NOT NULL UNIQUE, limits_json jsonb NOT NULL, config_hash char(64) NOT NULL UNIQUE, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS core.execution_version (
  execution_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), semantic_version text NOT NULL UNIQUE, policy_json jsonb NOT NULL, config_hash char(64) NOT NULL UNIQUE, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.cost_model_version (
  cost_model_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), semantic_version text NOT NULL UNIQUE, assumptions_json jsonb NOT NULL, config_hash char(64) NOT NULL UNIQUE, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.feature_version (
  feature_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), semantic_version text NOT NULL UNIQUE, definition_manifest_json jsonb NOT NULL, config_hash char(64) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.feature_definition (
  feature_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id), feature_name text NOT NULL, family text NOT NULL, source text NOT NULL, data_type text NOT NULL, formula_ref text, cadence text, treatment text NOT NULL, null_semantics text NOT NULL, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, UNIQUE(feature_version_id,feature_name)
);
CREATE TABLE IF NOT EXISTS core.reason_catalog (
  reason_code text PRIMARY KEY, reason_family text NOT NULL, description text NOT NULL, default_severity text, active_from timestamptz NOT NULL DEFAULT now(), active_to timestamptz
);

CREATE TABLE IF NOT EXISTS core.bot_instance (
  bot_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), bot_code text NOT NULL DEFAULT 'THETA', mode core.operating_mode NOT NULL DEFAULT 'RESEARCH', scheduler_enabled boolean NOT NULL DEFAULT false, strategy_version_id uuid REFERENCES core.strategy_version(strategy_version_id), risk_limit_version_id uuid REFERENCES core.risk_limit_version(risk_limit_version_id), execution_version_id uuid REFERENCES core.execution_version(execution_version_id), cost_model_version_id uuid REFERENCES core.cost_model_version(cost_model_version_id), feature_version_id uuid REFERENCES core.feature_version(feature_version_id), state text NOT NULL DEFAULT 'IDLE', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id, bot_code)
);
CREATE TABLE IF NOT EXISTS core.bot_mode_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), old_mode core.operating_mode, new_mode core.operating_mode NOT NULL, actor_id uuid REFERENCES iam.app_user(user_id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.config_activation (
  activation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), version_type text NOT NULL, version_id uuid NOT NULL, activated_at timestamptz NOT NULL DEFAULT now(), deactivated_at timestamptz, actor_id uuid REFERENCES iam.app_user(user_id), reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS market.underlying (
  underlying_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), symbol varchar(16) NOT NULL, asset_type text NOT NULL, exchange text, currency text NOT NULL DEFAULT 'USD', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(symbol, exchange)
);
CREATE TABLE IF NOT EXISTS market.option_contract (
  option_contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_contract_id text, contract_symbol varchar(64) NOT NULL UNIQUE, underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), option_type core.option_type NOT NULL, strike numeric(20,8) NOT NULL CHECK(strike > 0), expiration_date date NOT NULL, multiplier numeric(20,8) NOT NULL DEFAULT 100 CHECK(multiplier > 0), style text, settlement text, deliverable_json jsonb NOT NULL DEFAULT '{}'::jsonb, tradable boolean NOT NULL DEFAULT false, adjusted_flag boolean NOT NULL DEFAULT false, status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_option_contract_chain ON market.option_contract(underlying_id, expiration_date, option_type, strike);
CREATE TABLE IF NOT EXISTS market.market_session (
  session_date date NOT NULL, exchange text NOT NULL, open_at timestamptz NOT NULL, close_at timestamptz NOT NULL, session_state text NOT NULL, source text NOT NULL, PRIMARY KEY(session_date, exchange)
);
CREATE TABLE IF NOT EXISTS market.corporate_action (
  corporate_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), provider_action_id text, action_type text NOT NULL, ex_date date, record_date date, payable_date date, cash_amount numeric(24,8), ratio_json jsonb, status text, source_as_of timestamptz, retrieved_at timestamptz NOT NULL, payload_hash char(64), UNIQUE(underlying_id, provider_action_id)
);

CREATE TABLE IF NOT EXISTS market.stock_quote_snapshot (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), bid numeric(20,8), ask numeric(20,8), bid_size numeric(20,8), ask_size numeric(20,8), as_of timestamptz NOT NULL, retrieved_at timestamptz NOT NULL, feed text NOT NULL, quality core.data_quality NOT NULL, provider_request_id bigint REFERENCES core.provider_request(request_id)
);
CREATE INDEX IF NOT EXISTS ix_stock_quote_latest ON market.stock_quote_snapshot(underlying_id, as_of DESC);
CREATE TABLE IF NOT EXISTS market.stock_bar (
  bar_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), timeframe text NOT NULL, bar_start timestamptz NOT NULL, open numeric(20,8), high numeric(20,8), low numeric(20,8), close numeric(20,8), volume numeric(24,8), trade_count bigint, vwap numeric(20,8), feed text NOT NULL, quality core.data_quality NOT NULL, UNIQUE(underlying_id,timeframe,bar_start,feed)
);
CREATE TABLE IF NOT EXISTS market.option_quote_snapshot (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id), bid numeric(20,8), ask numeric(20,8), bid_size numeric(20,8), ask_size numeric(20,8), last_price numeric(20,8), as_of timestamptz NOT NULL, retrieved_at timestamptz NOT NULL, feed text NOT NULL, quality core.data_quality NOT NULL, provider_request_id bigint REFERENCES core.provider_request(request_id)
);
CREATE INDEX IF NOT EXISTS ix_option_quote_latest ON market.option_quote_snapshot(option_contract_id, as_of DESC);
CREATE TABLE IF NOT EXISTS market.option_greeks_snapshot (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id),
  delta numeric(24,12), gamma numeric(24,12), theta numeric(24,12), vega numeric(24,12), rho numeric(24,12), iv numeric(16,10),
  method text NOT NULL, source text NOT NULL,
  unit_basis text NOT NULL,
  normalization_version text NOT NULL,
  as_of timestamptz NOT NULL, retrieved_at timestamptz NOT NULL,
  quality core.data_quality NOT NULL
);
CREATE TABLE IF NOT EXISTS market.optionomics_feature_family_contract (
  feature_family text NOT NULL,
  contract_version text NOT NULL,
  provider_operation_alias text NOT NULL,
  canonical_schema_json jsonb NOT NULL,
  field_map_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  notes text,
  PRIMARY KEY(feature_family, contract_version)
);
CREATE TABLE IF NOT EXISTS market.optionomics_feature_snapshot (
  feature_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  underlying_id uuid REFERENCES market.underlying(underlying_id),
  option_contract_id uuid REFERENCES market.option_contract(option_contract_id),
  feature_family text NOT NULL,
  family_contract_version text NOT NULL,
  as_of timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  quality core.data_quality NOT NULL,
  canonical_json jsonb NOT NULL,
  payload_hash char(64),
  provider_request_id bigint REFERENCES core.provider_request(request_id),
  FOREIGN KEY(feature_family, family_contract_version)
    REFERENCES market.optionomics_feature_family_contract(feature_family, contract_version)
);
CREATE INDEX IF NOT EXISTS ix_optionomics_feature_latest ON market.optionomics_feature_snapshot(underlying_id, feature_family, family_contract_version, as_of DESC);
CREATE TABLE IF NOT EXISTS market.feature_snapshot (
  feature_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_type text NOT NULL, target_id text NOT NULL, feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id), as_of timestamptz NOT NULL, values_json jsonb NOT NULL, quality_json jsonb NOT NULL DEFAULT '{}'::jsonb, source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb, content_hash char(64) NOT NULL, UNIQUE(feature_version_id,target_type,target_id,as_of,content_hash)
);
CREATE TABLE IF NOT EXISTS market.optionomics_event (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), underlying_id uuid REFERENCES market.underlying(underlying_id), event_type text NOT NULL, event_time timestamptz, announced_at timestamptz, as_of timestamptz NOT NULL, importance numeric(10,9), payload_json jsonb NOT NULL, quality core.data_quality NOT NULL
);
CREATE TABLE IF NOT EXISTS market.regime_snapshot (
  regime_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), underlying_id uuid REFERENCES market.underlying(underlying_id), decision_time timestamptz NOT NULL, trend_state text NOT NULL, volatility_state text NOT NULL, event_state text NOT NULL, liquidity_state text NOT NULL, stress_state text NOT NULL, feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id), model_version_id uuid, scores_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS core.universe_version (
  universe_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), name text NOT NULL, version text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz, UNIQUE(workspace_id,name,version)
);
CREATE TABLE IF NOT EXISTS core.universe_member (
  universe_version_id uuid NOT NULL REFERENCES core.universe_version(universe_version_id) ON DELETE CASCADE, underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), membership_state text NOT NULL, reason_code text, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY(universe_version_id,underlying_id)
);
CREATE TABLE IF NOT EXISTS core.watchlist (
  watchlist_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_by uuid REFERENCES iam.app_user(user_id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,name)
);
CREATE TABLE IF NOT EXISTS core.watchlist_member (
  watchlist_id uuid NOT NULL REFERENCES core.watchlist(watchlist_id) ON DELETE CASCADE, underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), added_at timestamptz NOT NULL DEFAULT now(), note text, PRIMARY KEY(watchlist_id,underlying_id)
);
CREATE TABLE IF NOT EXISTS core.symbol_rule (
  symbol_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), rule_type text NOT NULL, state text NOT NULL, reason text, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, created_by uuid REFERENCES iam.app_user(user_id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.model_version (
  model_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_name text NOT NULL, model_role text NOT NULL, semantic_version text NOT NULL, artifact_uri text NOT NULL, artifact_hash char(64) NOT NULL, feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id), training_cutoff timestamptz NOT NULL, training_window jsonb NOT NULL, status text NOT NULL, metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(model_name,semantic_version)
);
ALTER TABLE market.regime_snapshot DROP CONSTRAINT IF EXISTS regime_model_fk;
ALTER TABLE market.regime_snapshot ADD CONSTRAINT regime_model_fk FOREIGN KEY(model_version_id) REFERENCES research.model_version(model_version_id);
CREATE TABLE IF NOT EXISTS research.model_deployment (
  model_deployment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), model_role text NOT NULL, champion_model_version_id uuid NOT NULL REFERENCES research.model_version(model_version_id), challenger_model_version_id uuid REFERENCES research.model_version(model_version_id), state text NOT NULL, activated_at timestamptz NOT NULL DEFAULT now(), deactivated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_model_role ON research.model_deployment(bot_instance_id,model_role) WHERE deactivated_at IS NULL;
CREATE TABLE IF NOT EXISTS research.model_training_run (
  training_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_version_id uuid NOT NULL REFERENCES research.model_version(model_version_id), dataset_manifest_uri text NOT NULL, dataset_hash char(64) NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, code_commit text, params_json jsonb NOT NULL DEFAULT '{}'::jsonb, metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS research.experiment (
  experiment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, hypothesis text NOT NULL, owner_user_id uuid REFERENCES iam.app_user(user_id), status text NOT NULL, frozen_test_period jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.experiment_variant (
  variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid NOT NULL REFERENCES research.experiment(experiment_id) ON DELETE CASCADE, name text NOT NULL, config_json jsonb NOT NULL, config_hash char(64) NOT NULL, status text NOT NULL, UNIQUE(experiment_id,config_hash)
);
CREATE TABLE IF NOT EXISTS research.benchmark_run (
  benchmark_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid REFERENCES research.experiment(experiment_id), benchmark_type text NOT NULL, dataset_manifest jsonb NOT NULL, results_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.ablation_result (
  ablation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid NOT NULL REFERENCES research.experiment(experiment_id), base_variant_id uuid REFERENCES research.experiment_variant(variant_id), added_component text NOT NULL, delta_ev numeric(24,8), delta_pf numeric(16,10), delta_wr numeric(16,10), delta_dd numeric(16,10), stats_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.expert_source (
  expert_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, platform text, evidence_class text NOT NULL, source_ref text, status text NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS research.expert_profile (
  expert_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expert_source_id uuid NOT NULL REFERENCES research.expert_source(expert_source_id), strategy_tags text[] NOT NULL DEFAULT '{}', reliability_state text, notes text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS research.expert_observation (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expert_profile_id uuid NOT NULL REFERENCES research.expert_profile(expert_profile_id), observed_at timestamptz, underlying_id uuid REFERENCES market.underlying(underlying_id), option_contract_id uuid REFERENCES market.option_contract(option_contract_id), action_code text NOT NULL, evidence_state text NOT NULL, state_json jsonb NOT NULL DEFAULT '{}'::jsonb, source_locator text, outcome_json jsonb
);

CREATE TABLE IF NOT EXISTS trade.fusion_snapshot (
  fusion_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), decision_time timestamptz NOT NULL, trigger_type text NOT NULL, universe_version_id uuid REFERENCES core.universe_version(universe_version_id), strategy_version_id uuid NOT NULL REFERENCES core.strategy_version(strategy_version_id), feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id), risk_limit_version_id uuid NOT NULL REFERENCES core.risk_limit_version(risk_limit_version_id), execution_version_id uuid NOT NULL REFERENCES core.execution_version(execution_version_id), cost_model_version_id uuid NOT NULL REFERENCES core.cost_model_version(cost_model_version_id), account_snapshot_id bigint NOT NULL REFERENCES trade.account_snapshot(account_snapshot_id), feature_snapshot_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb, portfolio_state_json jsonb NOT NULL, provider_provenance_json jsonb NOT NULL, unknown_features_json jsonb NOT NULL DEFAULT '[]'::jsonb, snapshot_json jsonb NOT NULL, content_hash char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bot_instance_id, content_hash)
);
CREATE INDEX IF NOT EXISTS ix_fusion_time ON trade.fusion_snapshot(bot_instance_id, decision_time DESC);
CREATE TABLE IF NOT EXISTS trade.candidate_set (
  candidate_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id), branch core.strategy_branch NOT NULL, candidate_count int NOT NULL CHECK(candidate_count>=0), generated_at timestamptz NOT NULL, generator_version text NOT NULL, set_hash char(64) NOT NULL, UNIQUE(fusion_snapshot_id,branch,set_hash)
);
CREATE TABLE IF NOT EXISTS trade.candidate (
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_set_id uuid NOT NULL REFERENCES trade.candidate_set(candidate_set_id), underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), option_contract_id uuid REFERENCES market.option_contract(option_contract_id), structure_code text NOT NULL, rank int, action_feasible boolean NOT NULL, option_quote_snapshot_id bigint REFERENCES market.option_quote_snapshot(snapshot_id), regime_snapshot_id uuid REFERENCES market.regime_snapshot(regime_snapshot_id), p_win numeric(10,9) CHECK(p_win BETWEEN 0 AND 1), p_assignment numeric(10,9) CHECK(p_assignment BETWEEN 0 AND 1), ev_net numeric(24,8), break_even_wr numeric(10,9), edge_buffer numeric(16,10), cycle_utility numeric(24,10), ownership_score numeric(10,9), severe_dd_prob numeric(10,9), recovery_median_days numeric(16,6), recovery_p95_days numeric(16,6), fill_probability numeric(10,9), stress_loss numeric(24,8), capital_required numeric(24,8), capital_days numeric(24,8), metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_candidate_rank ON trade.candidate(candidate_set_id, rank);
CREATE TABLE IF NOT EXISTS trade.candidate_reason (
  candidate_reason_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id) ON DELETE CASCADE, reason_family text NOT NULL, reason_code text NOT NULL, polarity smallint NOT NULL CHECK(polarity IN (-1,0,1)), severity text, value_json jsonb, importance_rank int
);
CREATE TABLE IF NOT EXISTS trade.candidate_rejection (
  candidate_rejection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id), decision_id uuid, rejection_type text NOT NULL CHECK(rejection_type IN ('HARD','SOFT')), gate text NOT NULL, reason_code text NOT NULL REFERENCES core.reason_catalog(reason_code), shadow_eligible boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trade.decision (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id), candidate_set_id uuid REFERENCES trade.candidate_set(candidate_set_id), selected_candidate_id uuid REFERENCES trade.candidate(candidate_id), decision_kind text NOT NULL, action_code text NOT NULL, quantity numeric(20,8) NOT NULL DEFAULT 0 CHECK(quantity>=0), confidence numeric(10,9), expected_ev numeric(24,8), expected_utility numeric(24,10), aegis_action core.aegis_action NOT NULL, strategy_branch core.strategy_branch, decided_at timestamptz NOT NULL, status text NOT NULL, explanation_text text, explanation_hash char(64)
);
CREATE INDEX IF NOT EXISTS ix_decision_time ON trade.decision(decided_at DESC, action_code);
DO $$ BEGIN ALTER TABLE trade.candidate_rejection ADD CONSTRAINT candidate_rejection_decision_fk FOREIGN KEY(decision_id) REFERENCES trade.decision(decision_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS trade.decision_reason (
  decision_reason_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, decision_id uuid NOT NULL REFERENCES trade.decision(decision_id) ON DELETE CASCADE, reason_family text NOT NULL, reason_code text NOT NULL, polarity smallint NOT NULL CHECK(polarity IN (-1,0,1)), importance_rank int, value_json jsonb, evidence_state text
);
CREATE TABLE IF NOT EXISTS research.model_prediction (
  prediction_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, model_version_id uuid NOT NULL REFERENCES research.model_version(model_version_id), fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id), candidate_id uuid REFERENCES trade.candidate(candidate_id), target_name text NOT NULL, prediction numeric(20,12), uncertainty_low numeric(20,12), uncertainty_high numeric(20,12), generated_at timestamptz NOT NULL, features_hash char(64)
);
CREATE TABLE IF NOT EXISTS research.model_calibration_snapshot (
  calibration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_version_id uuid NOT NULL REFERENCES research.model_version(model_version_id), cohort_json jsonb NOT NULL, period_start date NOT NULL, period_end date NOT NULL, n int NOT NULL, brier numeric(20,12), log_loss numeric(20,12), reliability_json jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.model_drift_event (
  drift_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_version_id uuid NOT NULL REFERENCES research.model_version(model_version_id), detected_at timestamptz NOT NULL, drift_type text NOT NULL, severity text NOT NULL, metrics_json jsonb NOT NULL, action text NOT NULL
);
CREATE TABLE IF NOT EXISTS research.expert_prior_snapshot (
  prior_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fusion_snapshot_id uuid NOT NULL UNIQUE REFERENCES trade.fusion_snapshot(fusion_snapshot_id), generated_at timestamptz NOT NULL, weights_json jsonb NOT NULL, action_prior_json jsonb NOT NULL, similarity_json jsonb NOT NULL, version_hash char(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS risk.risk_snapshot (
  risk_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id), decision_id uuid REFERENCES trade.decision(decision_id), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), risk_limit_version_id uuid NOT NULL REFERENCES core.risk_limit_version(risk_limit_version_id), action core.aegis_action NOT NULL, risk_multiplier numeric(10,9), collateral_after numeric(24,8), utilization_after numeric(16,10), delta numeric(24,12), gamma numeric(24,12), theta numeric(24,12), vega numeric(24,12), expected_shortfall numeric(24,8), stress_loss numeric(24,8), concentration_json jsonb, inventory_risk_json jsonb, reason_json jsonb, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk.sizing_decision (
  sizing_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL UNIQUE REFERENCES trade.decision(decision_id),
  account_id uuid NOT NULL REFERENCES core.trading_account(account_id),
  proposed_qty numeric(20,8) NOT NULL CHECK(proposed_qty>=0),
  collateral_cap_qty numeric(20,8) CHECK(collateral_cap_qty>=0),
  stress_cap_qty numeric(20,8) CHECK(stress_cap_qty>=0),
  concentration_cap_qty numeric(20,8) CHECK(concentration_cap_qty>=0),
  broker_cap_qty numeric(20,8) CHECK(broker_cap_qty>=0),
  confidence_multiplier numeric(10,9) CHECK(confidence_multiplier BETWEEN 0 AND 1),
  aegis_multiplier numeric(10,9) CHECK(aegis_multiplier BETWEEN 0 AND 1),
  final_qty numeric(20,8) NOT NULL CHECK(final_qty>=0),
  sizing_policy_version text NOT NULL,
  diagnostics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS risk.correlation_snapshot (
  correlation_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  as_of timestamptz NOT NULL,
  underlying_a_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  underlying_b_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  lookback_days int NOT NULL CHECK(lookback_days>1),
  return_interval text NOT NULL,
  method text NOT NULL,
  correlation numeric(10,9) NOT NULL CHECK(correlation BETWEEN -1 AND 1),
  sample_count int NOT NULL CHECK(sample_count>1),
  feature_version_id uuid REFERENCES core.feature_version(feature_version_id),
  quality core.data_quality NOT NULL,
  content_hash char(64) NOT NULL,
  CHECK(underlying_a_id <> underlying_b_id),
  UNIQUE(underlying_a_id, underlying_b_id, as_of, lookback_days, return_interval, method)
);
CREATE INDEX IF NOT EXISTS ix_corr_underlying_a_time ON risk.correlation_snapshot(underlying_a_id, as_of DESC);
CREATE INDEX IF NOT EXISTS ix_corr_underlying_b_time ON risk.correlation_snapshot(underlying_b_id, as_of DESC);

CREATE TABLE IF NOT EXISTS risk.exposure_cluster_snapshot (
  cluster_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES core.trading_account(account_id),
  as_of timestamptz NOT NULL,
  method text NOT NULL,
  lookback_days int,
  threshold numeric(10,9),
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cluster_account_time ON risk.exposure_cluster_snapshot(account_id, as_of DESC);

CREATE TABLE IF NOT EXISTS risk.exposure_cluster_member (
  cluster_snapshot_id uuid NOT NULL REFERENCES risk.exposure_cluster_snapshot(cluster_snapshot_id) ON DELETE CASCADE,
  cluster_code text NOT NULL,
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  gross_exposure numeric(24,8),
  net_delta_share_equiv numeric(24,12),
  portfolio_weight numeric(10,9),
  sector_label text,
  PRIMARY KEY(cluster_snapshot_id, cluster_code, underlying_id)
);
CREATE INDEX IF NOT EXISTS ix_cluster_member_underlying ON risk.exposure_cluster_member(underlying_id, cluster_snapshot_id);

CREATE TABLE IF NOT EXISTS trade.order_intent (
  order_intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decision_id uuid NOT NULL REFERENCES trade.decision(decision_id), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), client_order_id text NOT NULL, intent_code text NOT NULL, instrument_json jsonb NOT NULL, quantity numeric(20,8) NOT NULL CHECK(quantity>0), limit_price numeric(20,8), time_in_force text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,client_order_id), UNIQUE(account_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS trade.execution_attempt (
  execution_attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id), attempt_no int NOT NULL, requested_at timestamptz NOT NULL, request_payload_hash char(64), response_at timestamptz, response_status text, timeout_flag boolean NOT NULL DEFAULT false, reconcile_before_retry boolean NOT NULL DEFAULT false, provider_request_id bigint REFERENCES core.provider_request(request_id), UNIQUE(order_intent_id,attempt_no)
);
CREATE TABLE IF NOT EXISTS trade.broker_order (
  broker_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_intent_id uuid NOT NULL UNIQUE REFERENCES trade.order_intent(order_intent_id), provider_order_id text NOT NULL UNIQUE, state text NOT NULL, submitted_at timestamptz, filled_qty numeric(20,8) NOT NULL DEFAULT 0, avg_fill_price numeric(20,8), limit_price numeric(20,8), replaced_by_id uuid REFERENCES trade.broker_order(broker_order_id), last_reconciled_at timestamptz, provider_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_broker_order_state ON trade.broker_order(state,submitted_at DESC);
CREATE TABLE IF NOT EXISTS trade.broker_order_event (
  order_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, broker_order_id uuid NOT NULL REFERENCES trade.broker_order(broker_order_id), provider_event_id text, event_type text NOT NULL, event_time timestamptz NOT NULL, qty_delta numeric(20,8), price numeric(20,8), payload_hash char(64), raw_ref text
);
CREATE TABLE IF NOT EXISTS trade.broker_activity (
  broker_activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), provider_activity_id text NOT NULL, activity_type text NOT NULL, activity_time timestamptz NOT NULL, underlying_id uuid REFERENCES market.underlying(underlying_id), option_contract_id uuid REFERENCES market.option_contract(option_contract_id), quantity numeric(20,8), price numeric(20,8), net_amount numeric(24,8), payload_json jsonb NOT NULL DEFAULT '{}'::jsonb, UNIQUE(account_id,provider_activity_id)
);
CREATE TABLE IF NOT EXISTS trade.fill (
  fill_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), broker_order_id uuid NOT NULL REFERENCES trade.broker_order(broker_order_id), provider_fill_id text NOT NULL UNIQUE, fill_time timestamptz NOT NULL, quantity numeric(20,8) NOT NULL CHECK(quantity>0), price numeric(20,8) NOT NULL, fees numeric(24,8) NOT NULL DEFAULT 0, liquidity_flag text, provider_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS trade.fill_model_prediction (
  fill_prediction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decision_id uuid NOT NULL REFERENCES trade.decision(decision_id), candidate_id uuid REFERENCES trade.candidate(candidate_id), model_version_id uuid REFERENCES research.model_version(model_version_id), limit_price numeric(20,8) NOT NULL, predicted_fill_prob numeric(10,9), expected_slippage numeric(24,8), generated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS trade.execution_markout (
  markout_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, fill_id uuid NOT NULL REFERENCES trade.fill(fill_id), horizon_seconds int NOT NULL, benchmark_price numeric(20,8), pnl_markout numeric(24,8), computed_at timestamptz NOT NULL, quote_source text NOT NULL, UNIQUE(fill_id,horizon_seconds)
);

CREATE TABLE IF NOT EXISTS trade.wheel_chain (
  wheel_chain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), opened_at timestamptz NOT NULL, closed_at timestamptz, status text NOT NULL, originating_branch core.strategy_branch NOT NULL, economic_goal text, strategy_version_id uuid NOT NULL REFERENCES core.strategy_version(strategy_version_id)
);
CREATE INDEX IF NOT EXISTS ix_open_wheel_chain ON trade.wheel_chain(account_id,underlying_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS trade.position_episode (
  position_episode_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wheel_chain_id uuid NOT NULL REFERENCES trade.wheel_chain(wheel_chain_id), episode_type text NOT NULL, opened_at timestamptz NOT NULL, resolved_at timestamptz, state text NOT NULL, origin_decision_id uuid REFERENCES trade.decision(decision_id), assigned_flag boolean NOT NULL DEFAULT false, outcome_label text, after_cost_pnl numeric(24,8), max_adverse_excursion numeric(24,8), max_favorable_excursion numeric(24,8), capital_days numeric(24,8), recovery_days numeric(16,6)
);
CREATE INDEX IF NOT EXISTS ix_open_episode ON trade.position_episode(wheel_chain_id,state) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS trade.episode_leg (
  episode_leg_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), position_episode_id uuid NOT NULL REFERENCES trade.position_episode(position_episode_id), leg_type text NOT NULL, option_contract_id uuid REFERENCES market.option_contract(option_contract_id), underlying_id uuid REFERENCES market.underlying(underlying_id), side_intent text NOT NULL, quantity numeric(20,8) NOT NULL, opened_by_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), closed_by_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), opened_at timestamptz NOT NULL, closed_at timestamptz, realized_pnl numeric(24,8), state text NOT NULL
);
CREATE TABLE IF NOT EXISTS trade.lifecycle_event (
  lifecycle_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, wheel_chain_id uuid NOT NULL REFERENCES trade.wheel_chain(wheel_chain_id), position_episode_id uuid REFERENCES trade.position_episode(position_episode_id), episode_leg_id uuid REFERENCES trade.episode_leg(episode_leg_id), event_type text NOT NULL, event_time timestamptz NOT NULL, provider_activity_id text, before_state text, after_state text, quantity numeric(20,8), price numeric(20,8), payload_json jsonb NOT NULL DEFAULT '{}'::jsonb, source text NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lifecycle_chain ON trade.lifecycle_event(wheel_chain_id,event_time);
CREATE TABLE IF NOT EXISTS trade.roll_link (
  roll_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wheel_chain_id uuid NOT NULL REFERENCES trade.wheel_chain(wheel_chain_id), old_leg_id uuid NOT NULL REFERENCES trade.episode_leg(episode_leg_id), new_leg_id uuid NOT NULL REFERENCES trade.episode_leg(episode_leg_id), close_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), open_order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), net_roll_credit numeric(24,8), days_extended int, strike_change numeric(20,8), incremental_utility numeric(24,10), created_at timestamptz NOT NULL DEFAULT now(), CHECK(old_leg_id<>new_leg_id), UNIQUE(old_leg_id,new_leg_id)
);
CREATE TABLE IF NOT EXISTS trade.broker_position_snapshot (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES core.trading_account(account_id),
  captured_at timestamptz NOT NULL,
  instrument_type text NOT NULL,
  instrument_id text NOT NULL,
  underlying_id uuid REFERENCES market.underlying(underlying_id),
  option_contract_id uuid REFERENCES market.option_contract(option_contract_id),
  position_sign smallint NOT NULL CHECK(position_sign IN (-1,1)),
  quantity numeric(20,8) NOT NULL CHECK(quantity>=0),
  avg_entry_price numeric(20,8),
  market_value numeric(24,8),
  unrealized_pnl numeric(24,8),
  provider_position_id text,
  payload_hash char(64),
  CHECK (
    (instrument_type='OPTION' AND option_contract_id IS NOT NULL)
    OR (instrument_type IN ('EQUITY','ETF','STOCK') AND underlying_id IS NOT NULL)
    OR (instrument_type NOT IN ('OPTION','EQUITY','ETF','STOCK'))
  )
);
CREATE TABLE IF NOT EXISTS trade.stock_lot (
  stock_lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wheel_chain_id uuid NOT NULL REFERENCES trade.wheel_chain(wheel_chain_id), position_episode_id uuid REFERENCES trade.position_episode(position_episode_id), underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id), acquired_at timestamptz NOT NULL, source_type text NOT NULL, quantity_initial numeric(20,8) NOT NULL, quantity_open numeric(20,8) NOT NULL, broker_basis_per_share numeric(20,8), economic_basis_per_share numeric(20,8), source_lifecycle_event_id bigint REFERENCES trade.lifecycle_event(lifecycle_event_id), CHECK(quantity_initial>=0 AND quantity_open>=0 AND quantity_open<=quantity_initial)
);
CREATE TABLE IF NOT EXISTS trade.coverage_reservation (
  coverage_reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cc_leg_id uuid REFERENCES trade.episode_leg(episode_leg_id), order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), stock_lot_id uuid NOT NULL REFERENCES trade.stock_lot(stock_lot_id), shares_reserved numeric(20,8) NOT NULL CHECK(shares_reserved>0), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz
);
CREATE TABLE IF NOT EXISTS trade.collateral_reservation (
  collateral_reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), order_intent_id uuid REFERENCES trade.order_intent(order_intent_id), position_episode_id uuid REFERENCES trade.position_episode(position_episode_id), amount numeric(24,8) NOT NULL CHECK(amount>=0), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz
);
CREATE TABLE IF NOT EXISTS trade.economic_ledger_entry (
  ledger_entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES core.trading_account(account_id), wheel_chain_id uuid REFERENCES trade.wheel_chain(wheel_chain_id), position_episode_id uuid REFERENCES trade.position_episode(position_episode_id), episode_leg_id uuid REFERENCES trade.episode_leg(episode_leg_id), entry_type text NOT NULL, event_time timestamptz NOT NULL, amount numeric(24,8) NOT NULL, currency text NOT NULL DEFAULT 'USD', fill_id uuid REFERENCES trade.fill(fill_id), broker_activity_id uuid REFERENCES trade.broker_activity(broker_activity_id), source_ref text, immutable_hash char(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_economic_ledger_chain ON trade.economic_ledger_entry(wheel_chain_id,event_time);
CREATE TABLE IF NOT EXISTS trade.pnl_snapshot (
  pnl_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, target_type text NOT NULL, target_id uuid NOT NULL, as_of timestamptz NOT NULL, premium_cashflow numeric(24,8) NOT NULL DEFAULT 0, realized_option_pnl numeric(24,8) NOT NULL DEFAULT 0, unrealized_option_pnl numeric(24,8) NOT NULL DEFAULT 0, realized_stock_pnl numeric(24,8) NOT NULL DEFAULT 0, unrealized_stock_pnl numeric(24,8) NOT NULL DEFAULT 0, dividends numeric(24,8) NOT NULL DEFAULT 0, fees numeric(24,8) NOT NULL DEFAULT 0, slippage numeric(24,8) NOT NULL DEFAULT 0, carry_cost numeric(24,8) NOT NULL DEFAULT 0, whole_chain_pnl numeric(24,8) NOT NULL, broker_basis numeric(24,8), economic_basis numeric(24,8), currency text NOT NULL DEFAULT 'USD'
);
CREATE TABLE IF NOT EXISTS trade.capital_usage_snapshot (
  capital_usage_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES core.trading_account(account_id), wheel_chain_id uuid REFERENCES trade.wheel_chain(wheel_chain_id), as_of timestamptz NOT NULL, secured_collateral numeric(24,8) NOT NULL DEFAULT 0, broker_buying_power_used numeric(24,8), stock_market_value numeric(24,8), risk_budget_used numeric(24,8), capital_days_accrued numeric(24,8) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trade.outcome_label (
  outcome_label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), position_episode_id uuid NOT NULL UNIQUE REFERENCES trade.position_episode(position_episode_id), resolved_at timestamptz NOT NULL, managed_episode_win boolean NOT NULL, after_cost_pnl numeric(24,8) NOT NULL, break_even_wr_at_entry numeric(10,9), realized_holding_days numeric(16,6), assignment_occurred boolean NOT NULL, recovery_success boolean, outcome_version text NOT NULL
);
CREATE TABLE IF NOT EXISTS trade.management_decision (
  management_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decision_id uuid NOT NULL UNIQUE REFERENCES trade.decision(decision_id), position_episode_id uuid NOT NULL REFERENCES trade.position_episode(position_episode_id), current_state text NOT NULL, action_code text NOT NULL, hold_utility numeric(24,10), close_utility numeric(24,10), roll_utility numeric(24,10), assignment_utility numeric(24,10), redeploy_utility numeric(24,10), selected_utility numeric(24,10), policy_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS trade.manual_intervention (
  manual_intervention_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), requested_by uuid NOT NULL REFERENCES iam.app_user(user_id), requested_at timestamptz NOT NULL DEFAULT now(), requested_action text NOT NULL, target_type text NOT NULL, target_id uuid, reason text NOT NULL, pre_state_json jsonb NOT NULL, preflight_result jsonb, risk_result jsonb, linked_decision_id uuid REFERENCES trade.decision(decision_id), broker_result_json jsonb, resulting_state text
);

CREATE TABLE IF NOT EXISTS trade.shadow_decision (
  shadow_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id), fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id), original_decision_id uuid REFERENCES trade.decision(decision_id), reject_type text NOT NULL, reject_reason text NOT NULL, modeled_entry_price numeric(20,8), fill_model_version_id uuid REFERENCES research.model_version(model_version_id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trade.shadow_outcome (
  shadow_outcome_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shadow_decision_id uuid NOT NULL UNIQUE REFERENCES trade.shadow_decision(shadow_decision_id), evaluated_through timestamptz NOT NULL, modeled_fill_status text NOT NULL, after_cost_pnl numeric(24,8), managed_episode_win boolean, max_dd numeric(24,8), capital_days numeric(24,8), outcome_quality text NOT NULL, computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk.stress_scenario (
  stress_scenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, scenario_type text NOT NULL, assumptions_json jsonb NOT NULL, historical_window jsonb, version text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(name,version)
);
CREATE TABLE IF NOT EXISTS risk.stress_run (
  stress_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), risk_snapshot_id bigint REFERENCES risk.risk_snapshot(risk_snapshot_id), scenario_set_hash char(64) NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, status text NOT NULL
);
CREATE TABLE IF NOT EXISTS risk.stress_result (
  stress_result_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, stress_run_id uuid NOT NULL REFERENCES risk.stress_run(stress_run_id), scenario_id uuid NOT NULL REFERENCES risk.stress_scenario(stress_scenario_id), target_type text NOT NULL, target_id uuid, pnl_impact numeric(24,8), capital_impact numeric(24,8), greek_impact_json jsonb, breach_json jsonb
);
CREATE TABLE IF NOT EXISTS risk.kill_switch_event (
  kill_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), old_state text, new_state text NOT NULL, trigger_type text NOT NULL, trigger_ref text, actor_id uuid REFERENCES iam.app_user(user_id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS ops.provider_health_snapshot (
  health_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id), captured_at timestamptz NOT NULL, status text NOT NULL, latency_ms int, rate_limit_json jsonb, entitlement_json jsonb, freshness_json jsonb, error_rate numeric(16,10), details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS ops.alert (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), bot_instance_id uuid REFERENCES core.bot_instance(bot_instance_id), severity core.alert_severity NOT NULL, category text NOT NULL, source_type text, source_id uuid, title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), required_action text, status text NOT NULL DEFAULT 'OPEN'
);
CREATE TABLE IF NOT EXISTS ops.notification_preference (
  preference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), user_id uuid NOT NULL REFERENCES iam.app_user(user_id), category text NOT NULL, severity_floor core.alert_severity NOT NULL DEFAULT 'INFO', channels_json jsonb NOT NULL, cadence text NOT NULL DEFAULT 'REALTIME', quiet_hours_json jsonb, active boolean NOT NULL DEFAULT true, UNIQUE(workspace_id,user_id,category)
);
CREATE TABLE IF NOT EXISTS ops.alert_delivery (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alert_id uuid NOT NULL REFERENCES ops.alert(alert_id), user_id uuid REFERENCES iam.app_user(user_id), channel text NOT NULL, queued_at timestamptz NOT NULL, sent_at timestamptz, status text NOT NULL, error_code text, provider_message_id text
);
CREATE TABLE IF NOT EXISTS ops.alert_ack (
  ack_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alert_id uuid NOT NULL REFERENCES ops.alert(alert_id), user_id uuid NOT NULL REFERENCES iam.app_user(user_id), acknowledged_at timestamptz NOT NULL DEFAULT now(), note text, UNIQUE(alert_id,user_id)
);
CREATE TABLE IF NOT EXISTS ops.incident (
  incident_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), bot_instance_id uuid REFERENCES core.bot_instance(bot_instance_id), severity core.alert_severity NOT NULL, incident_type text NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, status text NOT NULL, summary text NOT NULL, runbook_ref text
);
CREATE TABLE IF NOT EXISTS ops.reconciliation_event (
  reconcile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), target_type text NOT NULL, target_id text, started_at timestamptz NOT NULL, ended_at timestamptz, result text NOT NULL, expected_state_json jsonb, broker_state_json jsonb, diff_json jsonb, action_taken text, blocking_new_risk boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS ops.state_drift_event (
  drift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES core.trading_account(account_id), target_ref text NOT NULL, detected_at timestamptz NOT NULL, drift_type text NOT NULL, expected_json jsonb, actual_json jsonb, status text NOT NULL, acknowledged_by uuid REFERENCES iam.app_user(user_id), acknowledged_at timestamptz
);
CREATE TABLE IF NOT EXISTS ops.audit_event (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), actor_type text NOT NULL, actor_user_id uuid REFERENCES iam.app_user(user_id), action text NOT NULL, object_type text NOT NULL, object_id text, occurred_at timestamptz NOT NULL DEFAULT now(), before_json jsonb, after_json jsonb, reason text, auth_context_json jsonb, request_id text, immutable_hash char(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_workspace_time ON ops.audit_event(workspace_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS ops.job_run (
  job_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid REFERENCES core.bot_instance(bot_instance_id), job_type text NOT NULL, trigger_type text NOT NULL, scheduled_for timestamptz, started_at timestamptz, ended_at timestamptz, status text NOT NULL, counters_json jsonb, error_json jsonb
);

CREATE TABLE IF NOT EXISTS ops.release_candidate (
  release_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id), stage text NOT NULL, version_manifest_json jsonb NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ops.release_evidence (
  release_evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_candidate_id uuid NOT NULL REFERENCES ops.release_candidate(release_candidate_id), gate_code text NOT NULL, evidence_type text NOT NULL, artifact_ref text, metrics_json jsonb, passed boolean, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ops.release_signature (
  signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_candidate_id uuid NOT NULL REFERENCES ops.release_candidate(release_candidate_id), domain text NOT NULL, signer_user_id uuid NOT NULL REFERENCES iam.app_user(user_id), decision text NOT NULL, comment text, signed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(release_candidate_id,domain,signer_user_id)
);

CREATE TABLE IF NOT EXISTS reporting.report_request (
  report_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id), requested_by uuid NOT NULL REFERENCES iam.app_user(user_id), report_type text NOT NULL, parameters_json jsonb NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL, version_manifest_json jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS reporting.report_artifact (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_request_id uuid NOT NULL REFERENCES reporting.report_request(report_request_id), format text NOT NULL, object_uri text NOT NULL, content_hash char(64) NOT NULL, generated_at timestamptz NOT NULL, expires_at timestamptz, status text NOT NULL, error_json jsonb
);
CREATE TABLE IF NOT EXISTS reporting.retention_policy (
  retention_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_class text NOT NULL, tier text NOT NULL, retain_days int, archive_after_days int, delete_eligible boolean NOT NULL DEFAULT false, provider_license_notes text, compliance_notes text, version text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(data_class,version)
);
CREATE TABLE IF NOT EXISTS reporting.archival_state (
  archival_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_type text NOT NULL, object_id text NOT NULL, policy_id uuid NOT NULL REFERENCES reporting.retention_policy(retention_policy_id), state text NOT NULL, archived_at timestamptz, deleted_at timestamptz, object_uri text, replay_limitation text, audit_id uuid REFERENCES ops.audit_event(audit_id), UNIQUE(object_type,object_id)
);

-- Read views: canonical metrics remain separated.
CREATE OR REPLACE VIEW analytics.v_open_wheel_chains AS
SELECT wc.*, pe.position_episode_id, pe.episode_type, pe.state AS episode_state, pe.after_cost_pnl
FROM trade.wheel_chain wc
LEFT JOIN trade.position_episode pe ON pe.wheel_chain_id=wc.wheel_chain_id AND pe.resolved_at IS NULL
WHERE wc.closed_at IS NULL;

CREATE OR REPLACE VIEW analytics.v_managed_episode_performance AS
SELECT
  count(*) AS resolved_episodes,
  count(*) FILTER (WHERE ol.managed_episode_win) AS winning_episodes,
  CASE WHEN count(*)>0 THEN (count(*) FILTER (WHERE ol.managed_episode_win))::numeric/count(*) ELSE NULL END AS managed_episode_wr,
  sum(ol.after_cost_pnl) AS total_after_cost_pnl
FROM trade.outcome_label ol;


CREATE OR REPLACE VIEW analytics.v_optionomics_feature_latest AS
SELECT DISTINCT ON (
  underlying_id,
  option_contract_id,
  feature_family
)
  feature_snapshot_id,
  underlying_id,
  option_contract_id,
  feature_family,
  family_contract_version,
  as_of,
  retrieved_at,
  quality,
  canonical_json,
  payload_hash,
  provider_request_id
FROM market.optionomics_feature_snapshot
ORDER BY
  underlying_id,
  option_contract_id,
  feature_family,
  as_of DESC,
  retrieved_at DESC,
  feature_snapshot_id DESC;

CREATE OR REPLACE VIEW analytics.v_portfolio_greeks_current AS
SELECT DISTINCT ON (account_id)
  account_id,
  risk_snapshot_id,
  created_at AS as_of,
  delta,
  gamma,
  theta,
  vega,
  risk_multiplier,
  action,
  risk_limit_version_id
FROM risk.risk_snapshot
ORDER BY account_id, created_at DESC, risk_snapshot_id DESC;

CREATE OR REPLACE VIEW analytics.v_correlation_latest AS
SELECT DISTINCT ON (
  underlying_a_id,
  underlying_b_id,
  lookback_days,
  return_interval,
  method
)
  correlation_snapshot_id,
  as_of,
  underlying_a_id,
  underlying_b_id,
  lookback_days,
  return_interval,
  method,
  correlation,
  sample_count,
  feature_version_id,
  quality,
  content_hash
FROM risk.correlation_snapshot
ORDER BY
  underlying_a_id,
  underlying_b_id,
  lookback_days,
  return_interval,
  method,
  as_of DESC,
  correlation_snapshot_id DESC;

CREATE OR REPLACE VIEW analytics.v_exposure_clusters_current AS
WITH latest AS (
  SELECT DISTINCT ON (account_id)
    cluster_snapshot_id,
    account_id,
    as_of,
    method,
    lookback_days,
    threshold,
    version
  FROM risk.exposure_cluster_snapshot
  ORDER BY account_id, as_of DESC, cluster_snapshot_id DESC
)
SELECT
  l.account_id,
  l.as_of,
  l.method,
  l.lookback_days,
  l.threshold,
  l.version,
  m.cluster_code,
  m.underlying_id,
  m.gross_exposure,
  m.net_delta_share_equiv,
  m.portfolio_weight,
  m.sector_label
FROM latest l
JOIN risk.exposure_cluster_member m
  ON m.cluster_snapshot_id = l.cluster_snapshot_id;

-- Validation notes:
-- 1) Application/CI fixtures MUST validate short-option P&L sign from signed fills/cashflows:
--    STO -> BTC profit is entry credit minus close debit after costs; BTO -> STC is exit credit minus entry debit after costs.
-- 2) Portfolio Greek normalization MUST respect market.option_greeks_snapshot.unit_basis and normalization_version,
--    signed position quantity, and option contract multiplier. Do not sum raw per-unit Greeks.
-- 3) risk.correlation_snapshot pairs MUST be canonicalized by the service before insert
--    (stable ordering of underlying IDs) so the UNIQUE key represents one economic pair.
-- 4) Typed surface/skew/term/flow analytics views MUST be added only after an ACTIVE
--    market.optionomics_feature_family_contract maps the actual documented Optionomics payload into canonical fields.

COMMIT;
