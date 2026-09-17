BEGIN;

CREATE TABLE legacy_neon.reconstruction_sweep(
  reconstruction_sweep_id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  source_code_sha text NOT NULL CHECK(source_code_sha ~ '^[0-9a-f]{7,40}$'),
  method_version text NOT NULL CHECK(length(btrim(method_version)) > 0),
  manifest_hash char(64) NOT NULL UNIQUE CHECK(manifest_hash ~ '^[0-9a-f]{64}$'),
  source_count integer NOT NULL CHECK(source_count >= 0),
  family_count integer NOT NULL CHECK(family_count >= 0),
  summary_json jsonb NOT NULL CHECK(jsonb_typeof(summary_json)='object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false)
);

CREATE TABLE legacy_neon.reconstruction_source(
  reconstruction_source_id uuid PRIMARY KEY,
  reconstruction_sweep_id uuid NOT NULL REFERENCES legacy_neon.reconstruction_sweep(reconstruction_sweep_id),
  source_type text NOT NULL CHECK(source_type IN (
    'LOCAL_EXPORT','RESEARCH_OUTPUT','WORKER_STATE','OPERATOR_RECEIPT','CI_ARTIFACT',
    'VERCEL_RUNTIME','GITHUB_DETERMINISTIC','ALPACA_DERIVED','OPTIONOMICS_DERIVED','AGENT_WORKSPACE','OTHER'
  )),
  source_system text NOT NULL CHECK(length(btrim(source_system)) > 0),
  source_locator text NOT NULL CHECK(length(btrim(source_locator)) > 0 AND source_locator !~* '(password|secret|token|api[_-]?key)=?'),
  source_project text,
  source_branch text,
  source_sha text,
  source_timestamp timestamptz,
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  reconstruction_method text NOT NULL CHECK(length(btrim(reconstruction_method)) > 0),
  confidence_class char(1) NOT NULL CHECK(confidence_class IN ('A','B','C','D','E')),
  pit_eligibility text NOT NULL CHECK(pit_eligibility IN ('ELIGIBLE','INELIGIBLE','UNKNOWN')),
  evidence_class text NOT NULL CHECK(evidence_class IN (
    'REAL_PRODUCTION_EVIDENCE','REAL_PROVIDER_EVIDENCE','DERIVED_RESEARCH','SIMULATION',
    'SYNTHETIC','TEST','METADATA_ONLY','UNKNOWN'
  )),
  record_count bigint NOT NULL CHECK(record_count >= 0),
  metadata_json jsonb NOT NULL CHECK(jsonb_typeof(metadata_json)='object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(reconstruction_sweep_id,source_type,source_locator,content_hash)
);

CREATE TABLE legacy_neon.family_recovery_assessment(
  family_recovery_assessment_id uuid PRIMARY KEY,
  reconstruction_sweep_id uuid NOT NULL REFERENCES legacy_neon.reconstruction_sweep(reconstruction_sweep_id),
  target_relation text NOT NULL CHECK(target_relation ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  purpose text NOT NULL,
  writer_modules_json jsonb NOT NULL CHECK(jsonb_typeof(writer_modules_json)='array'),
  source_origins_json jsonb NOT NULL CHECK(jsonb_typeof(source_origins_json)='array'),
  primary_key_columns_json jsonb NOT NULL CHECK(jsonb_typeof(primary_key_columns_json)='array'),
  foreign_key_parents_json jsonb NOT NULL CHECK(jsonb_typeof(foreign_key_parents_json)='array'),
  timestamp_semantics text NOT NULL,
  pit_requirements text NOT NULL,
  reconstructability text NOT NULL CHECK(reconstructability IN (
    'FULLY_RECOVERED','PARTIALLY_RECOVERED','RECONSTRUCTED_CURRENT_STATE',
    'RECONSTRUCTED_SCHEMA_ONLY','EMPTY_BY_DESIGN','NEON_ONLY_UNRECOVERABLE_CURRENTLY','UNKNOWN'
  )),
  exact_original_rows bigint NOT NULL CHECK(exact_original_rows >= 0),
  authoritative_rows bigint NOT NULL CHECK(authoritative_rows >= 0),
  deterministic_rows bigint NOT NULL CHECK(deterministic_rows >= 0),
  partial_rows bigint NOT NULL CHECK(partial_rows >= 0),
  current_aiven_rows bigint NOT NULL CHECK(current_aiven_rows >= 0),
  missing_parent_count bigint NOT NULL CHECK(missing_parent_count >= 0),
  useful_for_research boolean NOT NULL,
  useful_for_runtime boolean NOT NULL,
  blocking boolean NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  assessment_hash char(64) NOT NULL CHECK(assessment_hash ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(reconstruction_sweep_id,target_relation)
);

CREATE INDEX legacy_neon_reconstruction_source_kind_idx
  ON legacy_neon.reconstruction_source(source_type,confidence_class,evidence_class);
CREATE INDEX legacy_neon_family_recovery_state_idx
  ON legacy_neon.family_recovery_assessment(reconstructability,blocking,target_relation);

CREATE VIEW ops.legacy_reconstruction_latest AS
SELECT DISTINCT ON (fra.target_relation)
  fra.target_relation,
  fra.purpose,
  fra.source_origins_json,
  fra.reconstructability,
  fra.exact_original_rows,
  fra.authoritative_rows,
  fra.deterministic_rows,
  fra.partial_rows,
  fra.current_aiven_rows,
  fra.missing_parent_count,
  fra.useful_for_research,
  fra.useful_for_runtime,
  fra.blocking,
  rs.generated_at,
  rs.source_code_sha,
  rs.manifest_hash
FROM legacy_neon.family_recovery_assessment fra
JOIN legacy_neon.reconstruction_sweep rs USING(reconstruction_sweep_id)
ORDER BY fra.target_relation,rs.generated_at DESC,rs.reconstruction_sweep_id DESC;

DO $$ BEGIN
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.reconstruction_sweep
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.reconstruction_source
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.family_recovery_assessment
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('052_legacy_reconstruction_registry',repeat('0',64));

COMMIT;
