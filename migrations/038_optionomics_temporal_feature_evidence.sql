BEGIN;

CREATE TABLE research.optionomics_temporal_feature_observation (
  temporal_feature_id uuid PRIMARY KEY,
  underlying text NOT NULL,
  feature_family text NOT NULL CHECK(feature_family IN ('VOLATILITY','SKEW','TERM_STRUCTURE','EXPOSURE')),
  metric_key text NOT NULL,
  earlier_feature_snapshot_id uuid NOT NULL REFERENCES market.optionomics_feature_snapshot(feature_snapshot_id),
  current_feature_snapshot_id uuid NOT NULL REFERENCES market.optionomics_feature_snapshot(feature_snapshot_id),
  earlier_observed_at timestamptz NOT NULL,
  current_observed_at timestamptz NOT NULL,
  elapsed_seconds numeric NOT NULL CHECK(elapsed_seconds > 0),
  value_state text NOT NULL CHECK(value_state IN ('KNOWN','UNKNOWN','INVALID')),
  units text NOT NULL CHECK(units IN ('DECIMAL_IV','PROVIDER_REPORTED_UNVERIFIED')),
  earlier_value numeric,
  current_value numeric,
  absolute_change numeric,
  rate_per_hour numeric,
  reason_code text,
  method_version text NOT NULL,
  execution_eligible boolean NOT NULL DEFAULT false CHECK(execution_eligible = false),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(current_feature_snapshot_id,feature_family,metric_key,method_version),
  UNIQUE(content_hash),
  CONSTRAINT optionomics_temporal_distinct_snapshots CHECK(earlier_feature_snapshot_id <> current_feature_snapshot_id),
  CONSTRAINT optionomics_temporal_time_order CHECK(current_observed_at > earlier_observed_at),
  CONSTRAINT optionomics_temporal_known_shape CHECK(
    (value_state='KNOWN' AND earlier_value IS NOT NULL AND current_value IS NOT NULL
      AND absolute_change IS NOT NULL AND rate_per_hour IS NOT NULL AND reason_code IS NULL)
    OR
    (value_state IN ('UNKNOWN','INVALID') AND absolute_change IS NULL AND rate_per_hour IS NULL AND reason_code IS NOT NULL)
  )
);

CREATE INDEX ix_optionomics_temporal_underlying_time
  ON research.optionomics_temporal_feature_observation(underlying,current_observed_at DESC);
CREATE INDEX ix_optionomics_temporal_metric_time
  ON research.optionomics_temporal_feature_observation(feature_family,metric_key,current_observed_at DESC);

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON research.optionomics_temporal_feature_observation
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('038_optionomics_temporal_feature_evidence',repeat('0',64));

COMMIT;
