-- DRAFT (not applied, not under migrations/): THETA data platform schema. Validated against a real disposable PostgreSQL by tests/db/data-platform-postgres.test.ts.
-- Adding the numbered migration changes the runtime schema contract (expectedMaximum) and ships only through the governed release flow after the owner's go.
--
-- Principles: PostgreSQL = WORKING memory. Time-partitioned, append-only history that retires by DETACH + DROP of a whole partition after a verified archive
-- (no row DELETE, no bloat, space returns immediately). Shared context is stored once (dp.decision_context); candidates reference it. Large immutable payloads are
-- content addressed (dp.payload_blob) and observations reference them. There are deliberately NO foreign keys INTO partitioned history: a reference to a partition
-- that will retire must be a soft reference (hash/id) verified through the archive manifest, otherwise retirement would be blocked forever.

BEGIN;
CREATE SCHEMA IF NOT EXISTS dp;

-- ---- lifecycle control tables (small, permanent) -------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dp.partition_state (
  dataset text NOT NULL,
  partition_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE_HOT','CLOSED_HOT','ARCHIVE_PENDING','ARCHIVED_VERIFIED','DETACH_ELIGIBLE','DETACHED','DROPPED')),
  step text NOT NULL,
  record_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (dataset, partition_key)
);

CREATE TABLE IF NOT EXISTS dp.archive_manifest (
  archive_id char(40) PRIMARY KEY,
  bot_id text NOT NULL,
  dataset text NOT NULL,
  partition_key text NOT NULL,
  source_from text NOT NULL,
  source_to text NOT NULL,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  schema_version text NOT NULL,
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  policy_version text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  file_hash char(64) NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  created_at timestamptz NOT NULL,
  verified_at timestamptz,
  archive_location text NOT NULL,
  replay_verified text NOT NULL CHECK (replay_verified IN ('true','false','NOT_APPLICABLE')),
  purge_state text NOT NULL,
  manifest_hash char(64) NOT NULL,
  UNIQUE (dataset, partition_key, content_hash)
);

CREATE TABLE IF NOT EXISTS dp.storage_receipt (
  session_date date PRIMARY KEY,
  receipt_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dp.platform_incident (
  incident_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('UNBOUNDED_POSTGRES_GROWTH','ARCHIVE_BACKLOG','ARCHIVE_CORRUPTION','RETENTION_FAILURE','PARTITION_RETIREMENT_FAILURE','HOT_WRITE_AMPLIFICATION_REGRESSION','DATABASE_CAPACITY_FORECAST_BREACH',
    'DEFAULT_PARTITION_ROWS','LATE_WRITE_INTO_RETIRED_PARTITION','ARCHIVE_BACKEND_UNHEALTHY','PARQUET_VERIFICATION_FAILURE','DUAL_WRITE_WINDOW_EXPIRED','MAINTENANCE_INCOMPLETE','STORAGE_PRESSURE_STATE_UNAVAILABLE')),
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  dataset text,
  partition_key text,
  detail text NOT NULL,
  observed_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_platform_incident_open ON dp.platform_incident (kind, observed_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS dp.evidence_skipped (
  skipped_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind = 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE'),
  priority text NOT NULL,
  scope text NOT NULL,
  capacity_state text NOT NULL,
  observed_at timestamptz NOT NULL
);

-- ---- partitioned history (retire by partition) ---------------------------------------------------------------------------------------------------------------------
-- complete cycle evidence, the raw replay source of each decision (the single largest hot dataset)
CREATE TABLE IF NOT EXISTS dp.cycle_evidence_blob (
  fusion_snapshot_id uuid NOT NULL,
  session_date date NOT NULL,
  decided_at timestamptz NOT NULL,
  archive_hash char(64) NOT NULL CHECK (archive_hash ~ '^[0-9a-f]{64}$'),
  uncompressed_bytes bigint NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  blob bytea NOT NULL,
  PRIMARY KEY (fusion_snapshot_id, session_date)
) PARTITION BY RANGE (session_date);

-- shared per-decision context, stored ONCE; candidates reference it
CREATE TABLE IF NOT EXISTS dp.decision_context (
  decision_context_id uuid NOT NULL,
  session_date date NOT NULL,
  fusion_snapshot_id uuid,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz NOT NULL,
  context_json jsonb NOT NULL CHECK (jsonb_typeof(context_json) = 'object'),
  PRIMARY KEY (decision_context_id, session_date)
) PARTITION BY RANGE (session_date);
CREATE INDEX IF NOT EXISTS ix_decision_context_fusion ON dp.decision_context (fusion_snapshot_id);

-- ordinary rejected contracts are NOT stored as rows hot: counts per reason and the hash of the complete list (the rows live in the archive)
CREATE TABLE IF NOT EXISTS dp.rejection_histogram (
  decision_id uuid NOT NULL,
  session_date date NOT NULL,
  total_candidates integer NOT NULL CHECK (total_candidates >= 0),
  reason_counts jsonb NOT NULL CHECK (jsonb_typeof(reason_counts) = 'object'),
  candidate_list_hash char(64) NOT NULL CHECK (candidate_list_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, session_date)
) PARTITION BY RANGE (session_date);

-- content-addressed payloads (raw provider responses, option chain snapshots): identical bytes are stored once per partition window
CREATE TABLE IF NOT EXISTS dp.payload_blob (
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  session_date date NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  payload bytea NOT NULL,
  PRIMARY KEY (content_hash, session_date)
) PARTITION BY RANGE (session_date);

-- WHEN a payload was observed is separate from WHAT it was: the same bytes observed twice are one blob and two observations
CREATE TABLE IF NOT EXISTS dp.payload_observation (
  observation_id uuid NOT NULL,
  session_date date NOT NULL,
  observed_at timestamptz NOT NULL,
  kind text NOT NULL,
  provider text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL,
  latency_ms integer,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  archive_id char(40),
  PRIMARY KEY (observation_id, session_date)
) PARTITION BY RANGE (session_date);
CREATE INDEX IF NOT EXISTS ix_payload_observation_hash ON dp.payload_observation (content_hash);

-- normalized point-in-time evidence: scalar legacy columns plus ONLY the candidate-specific part of the sixteen JSON documents; the shared part lives in dp.decision_context
CREATE TABLE IF NOT EXISTS dp.pit_candidate (
  candidate_id uuid NOT NULL,
  session_date date NOT NULL,
  decision_context_id uuid NOT NULL,
  decision_id uuid,
  fusion_snapshot_id uuid NOT NULL,
  decision_time timestamptz NOT NULL,
  branch text NOT NULL,
  rank_at_decision integer CHECK (rank_at_decision IS NULL OR rank_at_decision > 0),
  selected boolean NOT NULL,
  hard_status text NOT NULL CHECK (hard_status IN ('FEASIBLE','HARD_VETO','INVALID','DATA_INSUFFICIENT')),
  soft_status text NOT NULL CHECK (soft_status IN ('RANKED','REJECTED','UNKNOWN')),
  rejection_reason text,
  strategy_version text NOT NULL,
  risk_version text NOT NULL,
  feature_version text NOT NULL,
  cost_model_version text NOT NULL,
  regime_version text NOT NULL,
  execution_model_version text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  inline_json jsonb NOT NULL CHECK (jsonb_typeof(inline_json) = 'object'),
  tier text NOT NULL DEFAULT 'FINALIST' CHECK (tier IN ('SELECTED','FINALIST','NEAR_BOUNDARY','ANOMALY','ORDINARY_REJECTED')),
  compact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, session_date)
) PARTITION BY RANGE (session_date);
CREATE INDEX IF NOT EXISTS ix_pit_candidate_decision ON dp.pit_candidate (decision_id);
CREATE INDEX IF NOT EXISTS ix_pit_candidate_context ON dp.pit_candidate (decision_context_id);
CREATE INDEX IF NOT EXISTS ix_pit_candidate_fusion ON dp.pit_candidate (fusion_snapshot_id);
-- the same access path the legacy table offered (research export: window by decision time ordered by candidate)
CREATE INDEX IF NOT EXISTS ix_pit_candidate_time ON dp.pit_candidate (decision_time, candidate_id);

-- exact reconstruction of the legacy row: an object column is `shared || candidate-specific`, an array column is the candidate's own value when present, else the shared one
CREATE OR REPLACE VIEW dp.candidate_point_in_time_evidence_v AS
SELECT c.candidate_id, c.decision_id, c.fusion_snapshot_id, c.decision_time, c.branch, c.rank_at_decision, c.selected, c.hard_status, c.soft_status, c.rejection_reason,
  c.strategy_version, c.risk_version, c.feature_version, c.cost_model_version, c.regime_version, c.execution_model_version, c.content_hash, c.tier, c.compact, c.created_at,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'contract_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'contract_json', '{}'::jsonb) || COALESCE(c.inline_json->'contract_json', '{}'::jsonb) END AS contract_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'market_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'market_json', '{}'::jsonb) || COALESCE(c.inline_json->'market_json', '{}'::jsonb) END AS market_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'volatility_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'volatility_json', '{}'::jsonb) || COALESCE(c.inline_json->'volatility_json', '{}'::jsonb) END AS volatility_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'technical_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'technical_json', '{}'::jsonb) || COALESCE(c.inline_json->'technical_json', '{}'::jsonb) END AS technical_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'event_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'event_json', '{}'::jsonb) || COALESCE(c.inline_json->'event_json', '{}'::jsonb) END AS event_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'flow_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'flow_json', '{}'::jsonb) || COALESCE(c.inline_json->'flow_json', '{}'::jsonb) END AS flow_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'ownership_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'ownership_json', '{}'::jsonb) || COALESCE(c.inline_json->'ownership_json', '{}'::jsonb) END AS ownership_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'account_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'account_json', '{}'::jsonb) || COALESCE(c.inline_json->'account_json', '{}'::jsonb) END AS account_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'portfolio_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'portfolio_json', '{}'::jsonb) || COALESCE(c.inline_json->'portfolio_json', '{}'::jsonb) END AS portfolio_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'aegis_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'aegis_json', '{}'::jsonb) || COALESCE(c.inline_json->'aegis_json', '{}'::jsonb) END AS aegis_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'execution_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'execution_json', '{}'::jsonb) || COALESCE(c.inline_json->'execution_json', '{}'::jsonb) END AS execution_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'known_economics_json', '{}'::jsonb) ELSE COALESCE(x.context_json->'known_economics_json', '{}'::jsonb) || COALESCE(c.inline_json->'known_economics_json', '{}'::jsonb) END AS known_economics_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'unknown_economics_json', '[]'::jsonb) ELSE COALESCE(c.inline_json->'unknown_economics_json', x.context_json->'unknown_economics_json', '[]'::jsonb) END AS unknown_economics_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'hard_blockers_json', '[]'::jsonb) ELSE COALESCE(c.inline_json->'hard_blockers_json', x.context_json->'hard_blockers_json', '[]'::jsonb) END AS hard_blockers_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'soft_evidence_json', '[]'::jsonb) ELSE COALESCE(c.inline_json->'soft_evidence_json', x.context_json->'soft_evidence_json', '[]'::jsonb) END AS soft_evidence_json,
  CASE WHEN c.compact THEN COALESCE(c.inline_json->'provider_provenance_json', '[]'::jsonb) ELSE COALESCE(c.inline_json->'provider_provenance_json', x.context_json->'provider_provenance_json', '[]'::jsonb) END AS provider_provenance_json
FROM dp.pit_candidate c
JOIN dp.decision_context x ON x.decision_context_id = c.decision_context_id AND x.session_date = c.session_date;

-- the pressure state the writers consult (one row written by the control plane). An absent, stale or malformed row is STORAGE_PRESSURE_UNKNOWN: bulk research is throttled,
-- new risk is restricted (locked after days of unknown), management is never affected, and P0 operational truth is ALWAYS written (see pressure-state.ts)
CREATE TABLE IF NOT EXISTS dp.storage_pressure_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  band text NOT NULL CHECK (band IN ('NORMAL','ARCHIVE_PRESSURE','RESEARCH_THROTTLED','NEW_RISK_RESTRICTED','STORAGE_CRITICAL')),
  database_bytes bigint NOT NULL,
  plan_bytes bigint NOT NULL,
  archive_queue_bytes bigint NOT NULL DEFAULT 0,
  archive_lag_sessions integer NOT NULL DEFAULT 0,
  archive_backend_healthy boolean NOT NULL DEFAULT true,
  projected_sessions_to_critical numeric,
  evaluated_at timestamptz NOT NULL
);

-- bounded dual-write ledger: one row per migrated writer path. SHADOW and DUAL_WRITE_VALIDATE are temporary by construction (dual_write_deadline); AUTHORITATIVE requires cutover_at and zero mismatches.
CREATE TABLE IF NOT EXISTS dp.dual_write_ledger (
  dataset text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('OFF','SHADOW','DUAL_WRITE_VALIDATE','AUTHORITATIVE')),
  dual_write_started_at timestamptz,
  dual_write_deadline timestamptz,
  parity_decisions bigint NOT NULL DEFAULT 0 CHECK (parity_decisions >= 0),
  parity_rows bigint NOT NULL DEFAULT 0 CHECK (parity_rows >= 0),
  mismatch_count bigint NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  cutover_at timestamptz,
  legacy_writer_disabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'AUTHORITATIVE' OR (cutover_at IS NOT NULL AND legacy_writer_disabled AND mismatch_count = 0))
);

-- DEFAULT partitions: an INSERT can never fail for want of a partition (a failed evidence write must not take a decision transaction down). The control plane pre-creates
-- real partitions several sessions ahead and raises PARTITION_RETIREMENT_FAILURE-class incidents if a default partition ever holds rows (late writers, missing partitions).
CREATE TABLE IF NOT EXISTS dp.cycle_evidence_blob_default PARTITION OF dp.cycle_evidence_blob DEFAULT;
CREATE TABLE IF NOT EXISTS dp.decision_context_default PARTITION OF dp.decision_context DEFAULT;
CREATE TABLE IF NOT EXISTS dp.rejection_histogram_default PARTITION OF dp.rejection_histogram DEFAULT;
CREATE TABLE IF NOT EXISTS dp.payload_blob_default PARTITION OF dp.payload_blob DEFAULT;
CREATE TABLE IF NOT EXISTS dp.payload_observation_default PARTITION OF dp.payload_observation DEFAULT;
CREATE TABLE IF NOT EXISTS dp.pit_candidate_default PARTITION OF dp.pit_candidate DEFAULT;
-- immutability: partitioned history is append-only. A row can only leave through DETACH + DROP of its partition (after a verified archive) or through the control plane's
-- default-partition repair, which sets dp.maintenance for the duration of its own transaction. This guards against accidental UPDATE/DELETE, not against the table owner.
CREATE OR REPLACE FUNCTION dp.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('dp.maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DP_APPEND_ONLY: % on % is not allowed (retire a whole partition instead)', TG_OP, TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
CREATE OR REPLACE FUNCTION dp.reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('dp.maintenance', true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'DP_APPEND_ONLY: TRUNCATE on % is not allowed', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['cycle_evidence_blob','decision_context','pit_candidate','rejection_histogram','payload_blob','payload_observation'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_mutation ON dp.%I', target);
    EXECUTE format('CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON dp.%I FOR EACH ROW EXECUTE FUNCTION dp.reject_mutation()', target);
    EXECUTE format('DROP TRIGGER IF EXISTS reject_truncate ON dp.%I', target);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON dp.%I FOR EACH STATEMENT EXECUTE FUNCTION dp.reject_truncate()', target);
  END LOOP;
END $$;

-- the compact permanent reference from a decision to its cold archive (cycle blobs leave PostgreSQL after their hot window; this survives): archive id, hashes, schema, source SHA, location.
-- Created only where the production trade.fusion_snapshot columns exist (the migration runs on the production schema; the data-platform-only test databases have no, or a stub, fusion table).
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'trade' AND table_name = 'fusion_snapshot' AND column_name IN ('fusion_snapshot_id','content_hash','evidence_archive_hash','decision_time')) = 4 THEN
    EXECUTE $v$CREATE OR REPLACE VIEW dp.cycle_archive_reference_v AS
      SELECT s.fusion_snapshot_id, s.content_hash AS snapshot_content_hash, s.evidence_archive_hash AS blob_content_hash, to_char(s.decision_time AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS session_date,
        m.archive_id, m.file_hash AS archive_file_hash, m.content_hash AS archive_content_hash, m.schema_version, m.source_sha, m.archive_location, m.verified_at, m.purge_state
      FROM trade.fusion_snapshot s
      LEFT JOIN LATERAL (SELECT * FROM dp.archive_manifest x WHERE x.dataset = 'cycle-evidence-blob' AND x.partition_key = to_char(s.decision_time AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
                         ORDER BY x.verified_at DESC NULLS LAST, x.created_at DESC LIMIT 1) m ON true$v$;
  END IF;
END $$;

COMMIT;
