BEGIN;

CREATE TABLE legacy_neon.local_forensic_sweep(
  forensic_sweep_id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  source_code_sha text NOT NULL CHECK(source_code_sha ~ '^[0-9a-f]{7,40}$'),
  method_version text NOT NULL CHECK(length(btrim(method_version))>0),
  root_manifest_hash char(64) NOT NULL UNIQUE CHECK(root_manifest_hash ~ '^[0-9a-f]{64}$'),
  chunk_count integer NOT NULL CHECK(chunk_count>0),
  expected_source_count integer NOT NULL CHECK(expected_source_count>=0),
  expected_variant_count integer NOT NULL CHECK(expected_variant_count>=0),
  expected_missing_search_count integer NOT NULL CHECK(expected_missing_search_count>=0),
  summary_json jsonb NOT NULL CHECK(jsonb_typeof(summary_json)='object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false)
);

CREATE TABLE legacy_neon.local_forensic_import_chunk(
  forensic_sweep_id uuid NOT NULL REFERENCES legacy_neon.local_forensic_sweep(forensic_sweep_id),
  chunk_index integer NOT NULL CHECK(chunk_index>=0),
  chunk_hash char(64) NOT NULL CHECK(chunk_hash ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  PRIMARY KEY(forensic_sweep_id,chunk_index)
);

CREATE TABLE legacy_neon.local_forensic_source(
  source_id uuid PRIMARY KEY,
  forensic_sweep_id uuid NOT NULL REFERENCES legacy_neon.local_forensic_sweep(forensic_sweep_id),
  source_scope text NOT NULL CHECK(source_scope IN(
    'RESEARCH_EXPORT','RESEARCH_OUTPUT','AGENT_WORKSPACE','GIT_UNREACHABLE','CI_ARTIFACT',
    'WORKTREE','EDITOR_HISTORY','SHELL_HISTORY','TEMPORARY_STORAGE','DOWNLOADS','WSL','DOCKER','OTHER')),
  source_locator text NOT NULL CHECK(length(btrim(source_locator))>0 AND source_locator !~* '(password|secret|token|api[_-]?key)=?'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK(byte_size>=0),
  modified_at timestamptz,
  exact_missing_key_matches integer NOT NULL CHECK(exact_missing_key_matches>=0),
  theta_fingerprint_matches integer NOT NULL CHECK(theta_fingerprint_matches>=0),
  evidence_class text NOT NULL CHECK(evidence_class IN('EXACT_EXPORT','DERIVED_RESEARCH','REFERENCE_ONLY','METADATA_ONLY','UNKNOWN')),
  disposition text NOT NULL CHECK(disposition IN('IMPORT_PAYLOAD','CATALOG_ONLY','REJECT_SECRET_BEARING','NO_RELEVANT_DATA')),
  metadata_json jsonb NOT NULL CHECK(jsonb_typeof(metadata_json)='object'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(forensic_sweep_id,source_locator,content_hash)
);

CREATE TABLE legacy_neon.research_export_variant(
  variant_id uuid PRIMARY KEY,
  forensic_sweep_id uuid NOT NULL REFERENCES legacy_neon.local_forensic_sweep(forensic_sweep_id),
  family text NOT NULL CHECK(family ~ '^[A-Za-z][A-Za-z0-9_]{0,119}$'),
  record_identity text NOT NULL CHECK(length(record_identity)>0),
  payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL,
  first_dataset_hash char(64) NOT NULL CHECK(first_dataset_hash ~ '^[0-9a-f]{64}$'),
  last_dataset_hash char(64) NOT NULL CHECK(last_dataset_hash ~ '^[0-9a-f]{64}$'),
  first_exported_at timestamptz NOT NULL,
  last_exported_at timestamptz NOT NULL CHECK(last_exported_at>=first_exported_at),
  occurrence_count integer NOT NULL CHECK(occurrence_count>0),
  is_latest_variant boolean NOT NULL,
  variant_class text NOT NULL CHECK(variant_class IN('CONFLICT_CURRENT','CONFLICT_HISTORICAL','OLDER_ONLY')),
  pit_eligibility text NOT NULL CHECK(pit_eligibility IN('ELIGIBLE','INELIGIBLE','UNKNOWN')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(forensic_sweep_id,family,record_identity,payload_hash)
);

CREATE TABLE legacy_neon.missing_record_forensic_search(
  search_id uuid PRIMARY KEY,
  forensic_sweep_id uuid NOT NULL REFERENCES legacy_neon.local_forensic_sweep(forensic_sweep_id),
  target_table text NOT NULL CHECK(target_table ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  missing_record_key text NOT NULL CHECK(length(missing_record_key)>0),
  reference_match_count integer NOT NULL CHECK(reference_match_count>=0),
  complete_record_match_count integer NOT NULL CHECK(complete_record_match_count>=0),
  matched_source_count integer NOT NULL CHECK(matched_source_count>=0),
  searched_scopes_json jsonb NOT NULL CHECK(jsonb_typeof(searched_scopes_json)='array'),
  recovery_state text NOT NULL CHECK(recovery_state IN('RECOVERED_EXACT','AMBIGUOUS','REFERENCE_ONLY','NOT_YET_RECOVERED','NOT_A_PARENT_REFERENCE')),
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  UNIQUE(forensic_sweep_id,target_table,missing_record_key)
);

CREATE INDEX local_forensic_source_scope_idx ON legacy_neon.local_forensic_source(source_scope,evidence_class);
CREATE INDEX research_export_variant_identity_idx ON legacy_neon.research_export_variant(family,record_identity);
CREATE INDEX missing_record_forensic_state_idx ON legacy_neon.missing_record_forensic_search(recovery_state,target_table);

CREATE VIEW ops.local_forensic_recovery_latest AS
SELECT s.generated_at,s.source_code_sha,s.root_manifest_hash,s.expected_source_count,s.expected_variant_count,
  s.expected_missing_search_count,
  (SELECT count(*) FROM legacy_neon.local_forensic_import_chunk c WHERE c.forensic_sweep_id=s.forensic_sweep_id) AS imported_chunks,
  (SELECT count(*) FROM legacy_neon.local_forensic_source f WHERE f.forensic_sweep_id=s.forensic_sweep_id) AS imported_sources,
  (SELECT count(*) FROM legacy_neon.research_export_variant v WHERE v.forensic_sweep_id=s.forensic_sweep_id) AS imported_variants,
  (SELECT count(*) FROM legacy_neon.missing_record_forensic_search m WHERE m.forensic_sweep_id=s.forensic_sweep_id) AS imported_missing_searches,
  s.summary_json,s.execution_authorized
FROM legacy_neon.local_forensic_sweep s
WHERE s.generated_at=(SELECT max(generated_at) FROM legacy_neon.local_forensic_sweep);

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['local_forensic_sweep','local_forensic_import_chunk','local_forensic_source',
    'research_export_variant','missing_record_forensic_search'] LOOP
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON legacy_neon.%I
      FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()',relation_name);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('053_local_forensic_recovery',repeat('0',64));

COMMIT;
