BEGIN;

-- Durable scheduler evidence. Existing rows remain valid and every new
-- invocation can prove who held the lease, which runtime/policy ran, when it
-- started and completed, and when it may next be considered.
ALTER TABLE ops.scheduler_checkpoint
  ADD COLUMN IF NOT EXISTS lease_acquired_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS runtime_version text,
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS result_status text,
  ADD COLUMN IF NOT EXISTS next_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ops.scheduler_checkpoint
  DROP CONSTRAINT IF EXISTS scheduler_checkpoint_result_status_check;
ALTER TABLE ops.scheduler_checkpoint
  ADD CONSTRAINT scheduler_checkpoint_result_status_check CHECK (
    result_status IS NULL OR result_status IN ('SUCCEEDED','DEGRADED','FAILED','SKIPPED','QUARANTINED')
  );

CREATE INDEX IF NOT EXISTS ix_scheduler_next_eligible
  ON ops.scheduler_checkpoint(next_eligible_at, status);

-- One append-only row per platform worker invocation. Vercel invokes the
-- worker by HTTP, so this is the durable heartbeat and audit record across
-- short-lived serverless processes and restarts.
CREATE TABLE IF NOT EXISTS ops.runtime_worker_cycle (
  worker_cycle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL UNIQUE,
  worker_role text NOT NULL CHECK (worker_role = 'THETA_PAPER_RUNTIME'),
  worker_instance text NOT NULL,
  runtime_version text NOT NULL,
  policy_version text NOT NULL,
  invoked_at timestamptz NOT NULL,
  completed_at timestamptz,
  heartbeat_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','DEGRADED','FAILED','QUARANTINED')),
  jobs_attempted integer NOT NULL DEFAULT 0 CHECK (jobs_attempted >= 0),
  jobs_completed integer NOT NULL DEFAULT 0 CHECK (jobs_completed >= 0),
  error_code text,
  error_detail text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR completed_at >= invoked_at)
);
CREATE INDEX IF NOT EXISTS ix_runtime_worker_cycle_recent
  ON ops.runtime_worker_cycle(invoked_at DESC);

-- Sanitized, immutable broker reconciliation evidence. Raw credentials and
-- authorization headers have no columns here. Payloads are represented by
-- hashes and bounded, non-secret metadata only.
CREATE TABLE IF NOT EXISTS trade.broker_reconciliation_snapshot (
  reconciliation_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  correlation_id text NOT NULL UNIQUE,
  environment text NOT NULL CHECK (environment = 'PAPER'),
  broker_host text NOT NULL CHECK (broker_host = 'paper-api.alpaca.markets'),
  account_status text,
  position_count integer CHECK (position_count IS NULL OR position_count >= 0),
  open_order_count integer CHECK (open_order_count IS NULL OR open_order_count >= 0),
  activity_count integer CHECK (activity_count IS NULL OR activity_count >= 0),
  matched_order_count integer NOT NULL DEFAULT 0 CHECK (matched_order_count >= 0),
  external_or_unknown_count integer NOT NULL DEFAULT 0 CHECK (external_or_unknown_count >= 0),
  observed_at timestamptz NOT NULL,
  provider_timestamp timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  data_quality text NOT NULL CHECK (data_quality IN ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED')),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_broker_reconciliation_connection
  ON trade.broker_reconciliation_snapshot(connection_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS trade.unmatched_broker_fact (
  unmatched_broker_fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  reconciliation_snapshot_id uuid NOT NULL REFERENCES trade.broker_reconciliation_snapshot(reconciliation_snapshot_id),
  fact_type text NOT NULL CHECK (fact_type IN ('ORDER','ACTIVITY','POSITION')),
  provider_fact_ref_hash char(64) NOT NULL CHECK (provider_fact_ref_hash ~ '^[0-9a-f]{64}$'),
  symbol text,
  classification text NOT NULL CHECK (classification = 'EXTERNAL_OR_UNKNOWN'),
  observed_at timestamptz NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(connection_id, fact_type, provider_fact_ref_hash)
);
CREATE INDEX IF NOT EXISTS ix_unmatched_broker_fact_connection
  ON trade.unmatched_broker_fact(connection_id, observed_at DESC);

-- Replay inputs and future outcomes are physically separate so an as-of
-- feature query cannot accidentally read a future label from the same row.
CREATE TABLE IF NOT EXISTS research.theta_replay_observation (
  replay_observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fusion_snapshot_id uuid REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  chain_id uuid REFERENCES trade.economic_chain(chain_id),
  underlying text NOT NULL,
  contract_symbol text,
  strategy_branch text,
  as_of timestamptz NOT NULL,
  provider_timestamp timestamptz,
  ingested_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  model_versions_json jsonb NOT NULL CHECK (jsonb_typeof(model_versions_json) = 'object'),
  provenance_json jsonb NOT NULL CHECK (jsonb_typeof(provenance_json) = 'object'),
  features_json jsonb NOT NULL CHECK (jsonb_typeof(features_json) = 'object'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(content_hash),
  CHECK (provider_timestamp IS NULL OR provider_timestamp <= as_of),
  CHECK (ingested_at >= as_of)
);
CREATE INDEX IF NOT EXISTS ix_theta_replay_asof
  ON research.theta_replay_observation(underlying, as_of);

CREATE TABLE IF NOT EXISTS research.theta_replay_outcome_label (
  replay_outcome_label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_observation_id uuid NOT NULL UNIQUE REFERENCES research.theta_replay_observation(replay_observation_id),
  label_available_at timestamptz NOT NULL,
  censoring_state text NOT NULL CHECK (censoring_state IN ('RESOLVED','RIGHT_CENSORED','INVALIDATED')),
  managed_episode_outcome text,
  whole_chain_pnl numeric(24,8),
  capital_days numeric(24,8),
  label_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION research.reject_early_replay_label()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observation_time timestamptz;
BEGIN
  SELECT as_of INTO observation_time FROM research.theta_replay_observation
    WHERE replay_observation_id=NEW.replay_observation_id;
  IF observation_time IS NULL OR NEW.label_available_at < observation_time THEN
    RAISE EXCEPTION 'REPLAY_LABEL_PRECEDES_OBSERVATION' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reject_early_replay_label ON research.theta_replay_outcome_label;
CREATE TRIGGER reject_early_replay_label BEFORE INSERT ON research.theta_replay_outcome_label
  FOR EACH ROW EXECUTE FUNCTION research.reject_early_replay_label();

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'broker_reconciliation_snapshot', 'unmatched_broker_fact'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', target);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      target
    );
  END LOOP;
  FOREACH target IN ARRAY ARRAY[
    'theta_replay_observation', 'theta_replay_outcome_label'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.%I', target);
    EXECUTE format(
      'CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',
      target
    );
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version, checksum)
VALUES ('015_autonomous_runtime_evidence', repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
