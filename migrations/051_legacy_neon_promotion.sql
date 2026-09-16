BEGIN;

CREATE TABLE legacy_neon.promotion_batch(
  promotion_batch_id uuid PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES legacy_neon.import_batch(import_batch_id),
  validator_version text NOT NULL,
  staging_fingerprint char(64) NOT NULL CHECK(staging_fingerprint ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  state text NOT NULL CHECK(state IN ('VALIDATING','COMPLETE','PARTIAL','REJECTED')),
  source_record_count bigint NOT NULL CHECK(source_record_count >= 0),
  classified_record_count bigint NOT NULL DEFAULT 0 CHECK(classified_record_count >= 0),
  disposition_counts_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(disposition_counts_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(import_batch_id,validator_version)
);

CREATE TABLE legacy_neon.promotion_record(
  promotion_record_id uuid PRIMARY KEY,
  promotion_batch_id uuid NOT NULL REFERENCES legacy_neon.promotion_batch(promotion_batch_id),
  artifact_record_id uuid NOT NULL REFERENCES legacy_neon.artifact_record(artifact_record_id),
  source_family text NOT NULL,
  source_record_key text NOT NULL,
  source_checksum char(64) NOT NULL CHECK(source_checksum ~ '^[0-9a-f]{64}$'),
  target_relation text NOT NULL,
  target_record_key text,
  observed_at timestamptz,
  disposition text NOT NULL CHECK(disposition IN (
    'PROMOTED_RESEARCH_HISTORY','PROMOTED_ENGINEERING_HISTORY','DUPLICATE_CANONICAL',
    'CONFLICT_QUARANTINED','CANONICAL_MATCH_QUARANTINED','REJECTED_INVALID'
  )),
  reason_code text NOT NULL,
  validation_json jsonb NOT NULL CHECK(jsonb_typeof(validation_json)='object'),
  promoted_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(promotion_batch_id,artifact_record_id)
);

CREATE INDEX legacy_neon_promotion_record_disposition_idx
  ON legacy_neon.promotion_record(promotion_batch_id,disposition,source_family);
CREATE INDEX legacy_neon_promotion_record_target_idx
  ON legacy_neon.promotion_record(target_relation,target_record_key);

CREATE VIEW research.legacy_neon_recovered_evidence AS
SELECT
  pr.promotion_record_id,
  pr.promotion_batch_id,
  ar.import_batch_id,
  pr.source_family,
  pr.source_record_key,
  pr.source_checksum,
  pr.target_relation,
  pr.target_record_key,
  pr.observed_at,
  ar.original_created_at,
  ar.classification,
  ar.pit_eligibility,
  ar.payload,
  pr.reason_code,
  pr.promoted_at
FROM legacy_neon.promotion_record pr
JOIN legacy_neon.artifact_record ar USING(artifact_record_id)
WHERE pr.disposition='PROMOTED_RESEARCH_HISTORY';

CREATE VIEW ops.legacy_neon_recovered_engineering_history AS
SELECT
  pr.promotion_record_id,
  pr.promotion_batch_id,
  ar.import_batch_id,
  pr.source_family,
  pr.source_record_key,
  pr.source_checksum,
  ar.payload,
  pr.reason_code,
  pr.promoted_at
FROM legacy_neon.promotion_record pr
JOIN legacy_neon.artifact_record ar USING(artifact_record_id)
WHERE pr.disposition='PROMOTED_ENGINEERING_HISTORY';

DO $$ BEGIN
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.promotion_record
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('051_legacy_neon_promotion',repeat('0',64));

COMMIT;
