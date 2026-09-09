BEGIN;

DO $$ BEGIN
  CREATE TYPE core.operating_mode AS ENUM ('RESEARCH', 'SHADOW', 'PAPER', 'LIVE_SMALL', 'LIVE', 'SAFE_HOLD', 'QUARANTINED', 'KILLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE core.strategy_branch AS ENUM ('THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK', 'THETA_RECOVERY', 'THETA_CC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE core.option_type AS ENUM ('CALL', 'PUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE core.data_quality AS ENUM ('GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE core.aegis_action AS ENUM ('ALLOW_FULL', 'ALLOW_REDUCED', 'DEFINED_RISK_ONLY', 'HOLD_ONLY', 'HARD_VETO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS core.trading_account (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id),
  provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id),
  provider_account_id text NOT NULL,
  base_currency text NOT NULL DEFAULT 'USD',
  environment text NOT NULL,
  options_level int,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_connection_id, provider_account_id)
);

CREATE TABLE IF NOT EXISTS core.provider_request (
  request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id),
  operation_alias text NOT NULL,
  requested_at timestamptz NOT NULL,
  responded_at timestamptz,
  status_code int,
  latency_ms int,
  rate_limit_json jsonb,
  payload_hash char(64),
  raw_payload_ref text,
  error_code text,
  request_meta_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_provider_request_time ON core.provider_request(provider_connection_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_provider_request_error ON core.provider_request(provider_connection_id, requested_at DESC) WHERE status_code >= 400;

CREATE TABLE IF NOT EXISTS core.strategy_version (
  strategy_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_version text NOT NULL UNIQUE,
  config_json jsonb NOT NULL,
  config_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS core.risk_limit_version (
  risk_limit_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_version text NOT NULL UNIQUE,
  limits_json jsonb NOT NULL,
  config_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS core.execution_version (
  execution_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_version text NOT NULL UNIQUE,
  policy_json jsonb NOT NULL,
  config_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.cost_model_version (
  cost_model_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_version text NOT NULL UNIQUE,
  assumptions_json jsonb NOT NULL,
  config_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.feature_version (
  feature_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semantic_version text NOT NULL UNIQUE,
  definition_manifest_json jsonb NOT NULL,
  config_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.universe_version (
  universe_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id),
  name text NOT NULL,
  version text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(workspace_id, name, version)
);

CREATE TABLE IF NOT EXISTS core.bot_instance (
  bot_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id),
  account_id uuid NOT NULL REFERENCES core.trading_account(account_id),
  bot_code text NOT NULL DEFAULT 'THETA',
  mode core.operating_mode NOT NULL DEFAULT 'RESEARCH',
  scheduler_enabled boolean NOT NULL DEFAULT false,
  strategy_version_id uuid REFERENCES core.strategy_version(strategy_version_id),
  risk_limit_version_id uuid REFERENCES core.risk_limit_version(risk_limit_version_id),
  execution_version_id uuid REFERENCES core.execution_version(execution_version_id),
  cost_model_version_id uuid REFERENCES core.cost_model_version(cost_model_version_id),
  feature_version_id uuid REFERENCES core.feature_version(feature_version_id),
  state text NOT NULL DEFAULT 'IDLE',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, bot_code)
);

CREATE TABLE IF NOT EXISTS trade.account_snapshot (
  account_snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES core.trading_account(account_id),
  equity numeric(24,8),
  cash numeric(24,8),
  buying_power numeric(24,8),
  options_buying_power numeric(24,8),
  options_level int,
  as_of timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  provider_request_id bigint REFERENCES core.provider_request(request_id),
  payload_hash char(64)
);
CREATE INDEX IF NOT EXISTS ix_account_snapshot_latest ON trade.account_snapshot(account_id, as_of DESC);

CREATE TABLE IF NOT EXISTS market.underlying (
  underlying_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(16) NOT NULL,
  asset_type text NOT NULL,
  exchange text,
  currency text NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, exchange)
);

CREATE TABLE IF NOT EXISTS market.option_contract (
  option_contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_contract_id text,
  contract_symbol varchar(64) NOT NULL UNIQUE,
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  option_type core.option_type NOT NULL,
  strike numeric(20,8) NOT NULL CHECK(strike > 0),
  expiration_date date NOT NULL,
  multiplier numeric(20,8) NOT NULL DEFAULT 100 CHECK(multiplier > 0),
  style text,
  settlement text,
  deliverable_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  tradable boolean NOT NULL DEFAULT false,
  adjusted_flag boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_option_contract_chain ON market.option_contract(underlying_id, expiration_date, option_type, strike);

CREATE TABLE IF NOT EXISTS market.option_quote_snapshot (
  snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id),
  bid numeric(20,8),
  ask numeric(20,8),
  bid_size numeric(20,8),
  ask_size numeric(20,8),
  last_price numeric(20,8),
  as_of timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  feed text NOT NULL,
  quality core.data_quality NOT NULL,
  provider_request_id bigint REFERENCES core.provider_request(request_id)
);
CREATE INDEX IF NOT EXISTS ix_option_quote_latest ON market.option_quote_snapshot(option_contract_id, as_of DESC);

CREATE TABLE IF NOT EXISTS research.model_version (
  model_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name text NOT NULL,
  model_role text NOT NULL,
  semantic_version text NOT NULL,
  artifact_uri text NOT NULL,
  artifact_hash char(64) NOT NULL,
  feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id),
  training_cutoff timestamptz NOT NULL,
  training_window jsonb NOT NULL,
  status text NOT NULL,
  metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(model_name, semantic_version)
);

CREATE TABLE IF NOT EXISTS market.regime_snapshot (
  regime_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying_id uuid REFERENCES market.underlying(underlying_id),
  decision_time timestamptz NOT NULL,
  trend_state text NOT NULL,
  volatility_state text NOT NULL,
  event_state text NOT NULL,
  liquidity_state text NOT NULL,
  stress_state text NOT NULL,
  feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id),
  model_version_id uuid REFERENCES research.model_version(model_version_id),
  scores_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trade.fusion_snapshot (
  fusion_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_instance_id uuid NOT NULL REFERENCES core.bot_instance(bot_instance_id),
  decision_time timestamptz NOT NULL,
  trigger_type text NOT NULL,
  universe_version_id uuid REFERENCES core.universe_version(universe_version_id),
  strategy_version_id uuid NOT NULL REFERENCES core.strategy_version(strategy_version_id),
  feature_version_id uuid NOT NULL REFERENCES core.feature_version(feature_version_id),
  risk_limit_version_id uuid NOT NULL REFERENCES core.risk_limit_version(risk_limit_version_id),
  execution_version_id uuid NOT NULL REFERENCES core.execution_version(execution_version_id),
  cost_model_version_id uuid NOT NULL REFERENCES core.cost_model_version(cost_model_version_id),
  account_snapshot_id bigint NOT NULL REFERENCES trade.account_snapshot(account_snapshot_id),
  feature_snapshot_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  portfolio_state_json jsonb NOT NULL,
  provider_provenance_json jsonb NOT NULL,
  unknown_features_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_json jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bot_instance_id, content_hash)
);
CREATE INDEX IF NOT EXISTS ix_fusion_time ON trade.fusion_snapshot(bot_instance_id, decision_time DESC);

CREATE TABLE IF NOT EXISTS trade.candidate_set (
  candidate_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  branch core.strategy_branch NOT NULL,
  candidate_count int NOT NULL CHECK(candidate_count >= 0),
  generated_at timestamptz NOT NULL,
  generator_version text NOT NULL,
  set_hash char(64) NOT NULL CHECK(set_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(fusion_snapshot_id, branch, set_hash)
);

CREATE TABLE IF NOT EXISTS trade.candidate (
  candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_set_id uuid NOT NULL REFERENCES trade.candidate_set(candidate_set_id),
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  option_contract_id uuid REFERENCES market.option_contract(option_contract_id),
  structure_code text NOT NULL,
  rank int CHECK(rank IS NULL OR rank > 0),
  action_feasible boolean NOT NULL,
  option_quote_snapshot_id bigint REFERENCES market.option_quote_snapshot(snapshot_id),
  regime_snapshot_id uuid REFERENCES market.regime_snapshot(regime_snapshot_id),
  p_win numeric(10,9) CHECK(p_win BETWEEN 0 AND 1),
  p_assignment numeric(10,9) CHECK(p_assignment BETWEEN 0 AND 1),
  ev_net numeric(24,8),
  break_even_wr numeric(10,9),
  edge_buffer numeric(16,10),
  cycle_utility numeric(24,10),
  ownership_score numeric(10,9),
  severe_dd_prob numeric(10,9),
  recovery_median_days numeric(16,6),
  recovery_p95_days numeric(16,6),
  fill_probability numeric(10,9),
  stress_loss numeric(24,8),
  capital_required numeric(24,8),
  capital_days numeric(24,8),
  metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_candidate_rank ON trade.candidate(candidate_set_id, rank);

CREATE TABLE IF NOT EXISTS trade.candidate_reason (
  candidate_reason_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id) ON DELETE CASCADE,
  reason_family text NOT NULL,
  reason_code text NOT NULL,
  polarity smallint NOT NULL CHECK(polarity IN (-1, 0, 1)),
  severity text,
  value_json jsonb,
  importance_rank int
);

CREATE TABLE IF NOT EXISTS trade.decision (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  candidate_set_id uuid REFERENCES trade.candidate_set(candidate_set_id),
  selected_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  decision_kind text NOT NULL,
  action_code text NOT NULL,
  quantity numeric(20,8) NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  confidence numeric(10,9),
  expected_ev numeric(24,8),
  expected_utility numeric(24,10),
  aegis_action core.aegis_action NOT NULL,
  strategy_branch core.strategy_branch,
  decided_at timestamptz NOT NULL,
  status text NOT NULL,
  explanation_text text,
  explanation_hash char(64) CHECK(explanation_hash IS NULL OR explanation_hash ~ '^[0-9a-f]{64}$'),
  CHECK(action_code <> 'WAIT' OR (selected_candidate_id IS NULL AND quantity = 0))
);
CREATE INDEX IF NOT EXISTS ix_decision_time ON trade.decision(decided_at DESC, action_code);

CREATE TABLE IF NOT EXISTS trade.decision_reason (
  decision_reason_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decision_id uuid NOT NULL REFERENCES trade.decision(decision_id) ON DELETE CASCADE,
  reason_family text NOT NULL,
  reason_code text NOT NULL,
  polarity smallint NOT NULL CHECK(polarity IN (-1, 0, 1)),
  importance_rank int,
  value_json jsonb,
  evidence_state text
);

CREATE OR REPLACE FUNCTION core.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fusion_snapshot', 'candidate_set', 'candidate', 'candidate_reason', 'decision', 'decision_reason'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO core.schema_migration (version, checksum)
VALUES ('003_immutable_decision_truth', '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
