BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy_neon;

CREATE TABLE legacy_neon.import_batch(
  import_batch_id uuid PRIMARY KEY,
  source_system text NOT NULL CHECK(source_system='NEON_LEGACY'),
  source_project_hash char(64) NOT NULL CHECK(source_project_hash ~ '^[0-9a-f]{64}$'),
  source_branch text NOT NULL,
  artifact_type text NOT NULL,
  dataset_hash char(64) CHECK(dataset_hash IS NULL OR dataset_hash ~ '^[0-9a-f]{64}$'),
  schema_version text,
  source_window_start timestamptz,
  source_window_end timestamptz,
  original_exported_at timestamptz,
  import_started_at timestamptz NOT NULL DEFAULT now(),
  import_completed_at timestamptz,
  status text NOT NULL CHECK(status IN ('STAGED','VALIDATING','APPROVED','REJECTED','BACKFILLED')),
  declared_row_count bigint NOT NULL CHECK(declared_row_count>=0),
  imported_row_count bigint NOT NULL DEFAULT 0 CHECK(imported_row_count>=0),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
  UNIQUE(source_system,artifact_type,dataset_hash,schema_version)
);

CREATE TABLE legacy_neon.artifact_file(
  artifact_file_id uuid PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES legacy_neon.import_batch(import_batch_id),
  file_name text NOT NULL CHECK(file_name !~ '[\\/]'),
  byte_length bigint NOT NULL CHECK(byte_length>=0),
  file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
  classification text NOT NULL CHECK(classification IN (
    'REAL_PRODUCTION_EVIDENCE','REAL_PROVIDER_EVIDENCE','SYNTHETIC','TEST_FIXTURE','REPLAY','UNKNOWN'
  )),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(import_batch_id,file_name),
  UNIQUE(file_sha256)
);

CREATE TABLE legacy_neon.artifact_record(
  artifact_record_id uuid PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES legacy_neon.import_batch(import_batch_id),
  source_family text NOT NULL,
  source_record_key text NOT NULL,
  source_checksum char(64) NOT NULL CHECK(source_checksum ~ '^[0-9a-f]{64}$'),
  original_created_at timestamptz,
  original_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  classification text NOT NULL CHECK(classification IN (
    'REAL_PRODUCTION_EVIDENCE','REAL_PROVIDER_EVIDENCE','SYNTHETIC','TEST_FIXTURE','REPLAY','UNKNOWN'
  )),
  pit_eligibility text NOT NULL CHECK(pit_eligibility IN ('ELIGIBLE','INELIGIBLE','UNKNOWN')),
  backfill_status text NOT NULL DEFAULT 'STAGED' CHECK(backfill_status IN (
    'STAGED','APPROVED','REJECTED','BACKFILLED','DUPLICATE'
  )),
  payload jsonb NOT NULL,
  UNIQUE(import_batch_id,source_family,source_record_key),
  UNIQUE(import_batch_id,source_checksum)
);

CREATE INDEX legacy_neon_artifact_record_family_idx
  ON legacy_neon.artifact_record(import_batch_id,source_family,original_created_at);
CREATE INDEX legacy_neon_artifact_record_backfill_idx
  ON legacy_neon.artifact_record(backfill_status,pit_eligibility,classification);

DO $$ BEGIN
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.artifact_file
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.artifact_record
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('050_legacy_neon_staging',repeat('0',64));
COMMIT;
