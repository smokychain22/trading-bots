BEGIN;

CREATE TABLE IF NOT EXISTS ops.runtime_worker_status (
  worker_id text PRIMARY KEY,
  lease_key text NOT NULL,
  host_id text NOT NULL,
  host_type text NOT NULL CHECK (host_type IN ('LOCAL_LAPTOP','VERCEL')),
  runtime_mode text NOT NULL CHECK (runtime_mode IN ('THETA_LOCAL_SHADOW','THETA_VERCEL_SHADOW')),
  build_sha text NOT NULL,
  runtime_version text NOT NULL,
  policy_version text NOT NULL,
  strategy_versions_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(strategy_versions_json)='array'),
  started_at timestamptz NOT NULL,
  stopped_at timestamptz,
  last_heartbeat timestamptz NOT NULL,
  last_cycle_started timestamptz,
  last_cycle_completed timestamptz,
  last_reconciliation timestamptz,
  last_candidate_scan timestamptz,
  last_provider_success timestamptz,
  last_sleep_gap_started timestamptz,
  last_sleep_gap_ended timestamptz,
  market_session text NOT NULL DEFAULT 'UNKNOWN' CHECK (market_session IN ('OPEN','CLOSED','UNKNOWN')),
  alpaca_health text NOT NULL DEFAULT 'UNKNOWN' CHECK (alpaca_health IN ('GOOD','DEGRADED','UNKNOWN')),
  optionomics_health text NOT NULL DEFAULT 'UNKNOWN' CHECK (optionomics_health IN ('GOOD','DEGRADED','UNKNOWN')),
  database_health text NOT NULL DEFAULT 'UNKNOWN' CHECK (database_health IN ('GOOD','DEGRADED','UNKNOWN')),
  execution_gate text NOT NULL CHECK (execution_gate='LOCKED'),
  state text NOT NULL CHECK (state IN ('STARTING','RECONCILING','SHADOW_RUNNING','WAITING_FOR_MARKET','DEGRADED','OFFLINE','STOPPING','ERROR')),
  failure_reason text,
  cycle_count bigint NOT NULL DEFAULT 0 CHECK (cycle_count >= 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
CREATE INDEX IF NOT EXISTS ix_runtime_worker_status_recent
  ON ops.runtime_worker_status(last_heartbeat DESC);

CREATE TABLE IF NOT EXISTS ops.runtime_worker_lease (
  lease_key text PRIMARY KEY,
  worker_id text NOT NULL REFERENCES ops.runtime_worker_status(worker_id),
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > heartbeat_at)
);

CREATE TABLE IF NOT EXISTS ops.runtime_worker_event (
  worker_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_id text NOT NULL REFERENCES ops.runtime_worker_status(worker_id),
  event_type text NOT NULL CHECK (event_type IN ('STARTED','LEASE_ACQUIRED','LEASE_TAKEN_OVER','RESUME_GAP','STOPPING','STOPPED','ERROR')),
  occurred_at timestamptz NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_runtime_worker_event_recent
  ON ops.runtime_worker_event(worker_id, occurred_at DESC);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON ops.runtime_worker_event;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.runtime_worker_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('020_local_worker_runtime',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
