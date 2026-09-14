BEGIN;

ALTER TABLE market.optionomics_raw_observation
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN request_path text,
  ADD COLUMN request_parameters_json jsonb,
  ADD COLUMN http_status integer CHECK(http_status BETWEEN 100 AND 599),
  ADD COLUMN rate_limit_json jsonb,
  ADD COLUMN documentation_reference text,
  ADD COLUMN credential_identity_ref_hash char(64)
    CHECK(credential_identity_ref_hash IS NULL OR credential_identity_ref_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN session_date date;

ALTER TABLE market.optionomics_raw_observation
  ADD CONSTRAINT optionomics_request_parameters_object
    CHECK(request_parameters_json IS NULL OR jsonb_typeof(request_parameters_json)='object'),
  ADD CONSTRAINT optionomics_rate_limit_object
    CHECK(rate_limit_json IS NULL OR jsonb_typeof(rate_limit_json)='object'),
  ADD CONSTRAINT optionomics_request_time_order
    CHECK(requested_at IS NULL OR requested_at <= ingestion_timestamp);

INSERT INTO core.schema_migration(version,checksum)
VALUES('029_optionomics_request_provenance',repeat('0',64));
COMMIT;
