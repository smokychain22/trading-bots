BEGIN;

CREATE TABLE market.optionomics_event_first_observation (
  observation_id uuid PRIMARY KEY,
  source_raw_observation_id uuid NOT NULL REFERENCES market.optionomics_raw_observation(observation_id),
  provider_event_id text NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  event_kind text,
  ticker text,
  event_date date,
  scheduled_at timestamptz,
  provider_known_at timestamptz,
  first_observed_at timestamptz NOT NULL,
  pit_timing_state text NOT NULL CHECK (pit_timing_state IN ('TIMING_VALID','KNOWN_AT_UNKNOWN','KNOWN_AFTER_OBSERVATION')),
  provider_payload_json jsonb NOT NULL CHECK (jsonb_typeof(provider_payload_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_event_id,payload_hash)
);

CREATE INDEX ix_optionomics_event_identity ON market.optionomics_event_first_observation(provider_event_id,first_observed_at);
CREATE INDEX ix_optionomics_event_ticker_date ON market.optionomics_event_first_observation(ticker,event_date);
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.optionomics_event_first_observation
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE TABLE research.optionomics_capability_qualification_receipt (
  qualification_id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  report_json jsonb NOT NULL CHECK (jsonb_typeof(report_json)='object'),
  report_hash char(64) NOT NULL UNIQUE CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_optionomics_capability_qualification_time
  ON research.optionomics_capability_qualification_receipt(generated_at DESC);
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.optionomics_capability_qualification_receipt
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('063_optionomics_event_first_observation',repeat('0',64));
COMMIT;
