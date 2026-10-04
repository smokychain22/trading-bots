-- DRAFT ONLY. Do not apply to Production without the governed 069/070/071 cutover approval.
-- Owner-approved representation change: immutable historical truth may leave hot PostgreSQL after terminal-chain,
-- two-authority archive, hash and replay verification. This schema keeps bounded recent windows and a chained head.
BEGIN;
CREATE SCHEMA IF NOT EXISTS dp;

CREATE TABLE IF NOT EXISTS dp.recent_decision_audit (
  decision_id uuid NOT NULL,
  session_date date NOT NULL,
  decided_at timestamptz NOT NULL,
  action_code text NOT NULL,
  strategy text,
  selected_candidate_id text,
  quantity numeric(20,8) NOT NULL CHECK (quantity >= 0),
  aegis_outcome text,
  sizing_outcome text,
  binding_constraint text,
  chain_id uuid,
  archival_terminal boolean NOT NULL,
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'object'),
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  archive_id char(40) NOT NULL,
  archive_hash char(64) NOT NULL CHECK (archive_hash ~ '^[0-9a-f]{64}$'),
  decision_hash char(64) NOT NULL CHECK (decision_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, session_date),
  CHECK (archival_terminal OR chain_id IS NOT NULL)
) PARTITION BY RANGE (session_date);

CREATE TABLE IF NOT EXISTS dp.final_chain_receipt (
  chain_id uuid NOT NULL,
  session_date date NOT NULL,
  finalized_at timestamptz NOT NULL,
  receipt_version text NOT NULL,
  archive_eligible boolean NOT NULL,
  blockers jsonb NOT NULL CHECK (jsonb_typeof(blockers) = 'array'),
  receipt_json jsonb NOT NULL CHECK (jsonb_typeof(receipt_json) = 'object'),
  receipt_hash char(64) NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, session_date),
  CHECK (archive_eligible = (jsonb_array_length(blockers) = 0))
) PARTITION BY RANGE (session_date);

CREATE TABLE IF NOT EXISTS dp.finalized_execution_history (
  chain_id uuid NOT NULL,
  session_date date NOT NULL,
  finalized_at timestamptz NOT NULL,
  final_chain_receipt_hash char(64) NOT NULL CHECK (final_chain_receipt_hash ~ '^[0-9a-f]{64}$'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  uncompressed_bytes bigint NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  history_gzip bytea NOT NULL,
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, session_date),
  CHECK (octet_length(history_gzip) = compressed_bytes)
) PARTITION BY RANGE (session_date);

CREATE TABLE IF NOT EXISTS dp.session_integrity_manifest (
  session_id text NOT NULL,
  session_date date NOT NULL,
  decision_count integer NOT NULL CHECK (decision_count >= 0),
  first_decision_id uuid,
  last_decision_id uuid,
  archive_ids jsonb NOT NULL CHECK (jsonb_typeof(archive_ids) = 'array'),
  archive_hashes jsonb NOT NULL CHECK (jsonb_typeof(archive_hashes) = 'array'),
  parquet_manifest_hashes jsonb NOT NULL CHECK (jsonb_typeof(parquet_manifest_hashes) = 'array'),
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'object'),
  schema_versions jsonb NOT NULL CHECK (jsonb_typeof(schema_versions) = 'array'),
  decision_integrity_root char(64) NOT NULL CHECK (decision_integrity_root ~ '^[0-9a-f]{64}$'),
  previous_session_integrity_root char(64) CHECK (previous_session_integrity_root IS NULL OR previous_session_integrity_root ~ '^[0-9a-f]{64}$'),
  session_integrity_root char(64) NOT NULL CHECK (session_integrity_root ~ '^[0-9a-f]{64}$'),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, session_date),
  UNIQUE (session_date, session_integrity_root)
) PARTITION BY RANGE (session_date);

CREATE TABLE IF NOT EXISTS dp.session_integrity_head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  session_id text NOT NULL,
  session_date date NOT NULL,
  session_integrity_root char(64) NOT NULL CHECK (session_integrity_root ~ '^[0-9a-f]{64}$'),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS dp.runtime_session_aggregate (
  session_date date NOT NULL,
  decision_count integer NOT NULL CHECK (decision_count >= 0),
  trade_count integer NOT NULL CHECK (trade_count >= 0),
  wait_reason_counts jsonb NOT NULL CHECK (jsonb_typeof(wait_reason_counts) = 'object'),
  strategy_counts jsonb NOT NULL CHECK (jsonb_typeof(strategy_counts) = 'object'),
  aegis_counts jsonb NOT NULL CHECK (jsonb_typeof(aegis_counts) = 'object'),
  sizing_counts jsonb NOT NULL CHECK (jsonb_typeof(sizing_counts) = 'object'),
  provider_incident_counts jsonb NOT NULL CHECK (jsonb_typeof(provider_incident_counts) = 'object'),
  error_counts jsonb NOT NULL CHECK (jsonb_typeof(error_counts) = 'object'),
  latency_percentiles_json jsonb NOT NULL CHECK (jsonb_typeof(latency_percentiles_json) = 'object'),
  storage_json jsonb NOT NULL CHECK (jsonb_typeof(storage_json) = 'object'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_date)
) PARTITION BY RANGE (session_date);

CREATE TABLE IF NOT EXISTS dp.historical_compaction_receipt (
  compaction_id uuid PRIMARY KEY,
  session_date date NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('DECISION','CHAIN','DIAGNOSTIC','RUNTIME_EVENT','SESSION_MANIFEST')),
  subject_id text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('KEEP_ACTIVE_DETAIL','KEEP_RECENT_DETAIL','KEEP_COMPACT_DECISION','RETIRE_DECISION_TO_COLD','ARCHIVE_RAW_KEEP_AGGREGATE')),
  primary_archive_id char(40) NOT NULL,
  primary_archive_hash char(64) NOT NULL CHECK (primary_archive_hash ~ '^[0-9a-f]{64}$'),
  secondary_authority text NOT NULL,
  off_machine_authority text NOT NULL,
  replay_verified_at timestamptz NOT NULL,
  final_chain_receipt_hash char(64),
  pre_compaction_hash char(64) NOT NULL CHECK (pre_compaction_hash ~ '^[0-9a-f]{64}$'),
  post_compaction_hash char(64) NOT NULL CHECK (post_compaction_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  source_sha char(40) NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_kind, subject_id, disposition)
);

CREATE TABLE IF NOT EXISTS dp.recent_decision_audit_default PARTITION OF dp.recent_decision_audit DEFAULT;
CREATE TABLE IF NOT EXISTS dp.final_chain_receipt_default PARTITION OF dp.final_chain_receipt DEFAULT;
CREATE TABLE IF NOT EXISTS dp.finalized_execution_history_default PARTITION OF dp.finalized_execution_history DEFAULT;
CREATE TABLE IF NOT EXISTS dp.session_integrity_manifest_default PARTITION OF dp.session_integrity_manifest DEFAULT;
CREATE TABLE IF NOT EXISTS dp.runtime_session_aggregate_default PARTITION OF dp.runtime_session_aggregate DEFAULT;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['recent_decision_audit','final_chain_receipt','finalized_execution_history','session_integrity_manifest','runtime_session_aggregate','historical_compaction_receipt'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_mutation ON dp.%I', target);
    EXECUTE format('CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE ON dp.%I FOR EACH ROW EXECUTE FUNCTION dp.reject_mutation()', target);
    EXECUTE format('DROP TRIGGER IF EXISTS reject_truncate ON dp.%I', target);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON dp.%I FOR EACH STATEMENT EXECUTE FUNCTION dp.reject_truncate()', target);
  END LOOP;
END $$;

COMMIT;
