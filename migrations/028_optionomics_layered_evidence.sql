BEGIN;

CREATE TABLE market.optionomics_raw_observation (
  observation_id uuid PRIMARY KEY,
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  operation_alias text NOT NULL,
  underlying text NOT NULL,
  provider_timestamp timestamptz,
  ingestion_timestamp timestamptz NOT NULL,
  as_of timestamptz NOT NULL,
  contract_version text NOT NULL,
  data_quality text NOT NULL CHECK(data_quality IN ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED')),
  response_hash char(64) NOT NULL CHECK(response_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fusion_snapshot_id,operation_alias,response_hash),
  CHECK(provider_timestamp IS NULL OR provider_timestamp <= as_of),
  CHECK(ingestion_timestamp >= as_of)
);

CREATE TABLE market.optionomics_feature_snapshot (
  feature_snapshot_id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES market.optionomics_raw_observation(observation_id),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  underlying text NOT NULL,
  observed_at timestamptz NOT NULL,
  schema_version text NOT NULL,
  data_quality text NOT NULL CHECK(data_quality IN ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED')),
  feature_state_json jsonb NOT NULL CHECK(jsonb_typeof(feature_state_json)='object'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(observation_id,schema_version),
  UNIQUE(fusion_snapshot_id,content_hash)
);

CREATE TABLE research.optionomics_quote_qualification_run (
  qualification_run_id uuid PRIMARY KEY,
  run_at timestamptz NOT NULL,
  market_session text NOT NULL CHECK(market_session IN ('OPEN','CLOSED','UNKNOWN')),
  symbols_json jsonb NOT NULL CHECK(jsonb_typeof(symbols_json)='array'),
  samples_requested integer NOT NULL CHECK(samples_requested > 0),
  samples_observed integer NOT NULL CHECK(samples_observed >= 0 AND samples_observed <= samples_requested),
  two_sided_observations integer NOT NULL CHECK(two_sided_observations >= 0),
  fresh_observations integer NOT NULL CHECK(fresh_observations >= 0),
  semantic_authority text NOT NULL CHECK(semantic_authority IN ('RESEARCH_ONLY','ORDER_PRICING_DOCUMENTED')),
  readiness_state text NOT NULL CHECK(readiness_state IN ('READY','BLOCKED_ON_QUOTE_PROOF','BLOCKED_ON_MARKET_SESSION','BLOCKED_ON_DATA')),
  ready boolean NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optionomics_quote_ready_requires_documented_authority
    CHECK((ready AND readiness_state='READY' AND semantic_authority='ORDER_PRICING_DOCUMENTED') OR NOT ready)
);

CREATE INDEX ix_optionomics_raw_time ON market.optionomics_raw_observation(underlying,as_of DESC);
CREATE INDEX ix_optionomics_feature_time ON market.optionomics_feature_snapshot(underlying,observed_at DESC);

CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.optionomics_raw_observation
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.optionomics_feature_snapshot
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.optionomics_quote_qualification_run
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('028_optionomics_layered_evidence',repeat('0',64));
COMMIT;
