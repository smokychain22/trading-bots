BEGIN;

CREATE TABLE market.optionomics_feature_observation_link (
  feature_snapshot_id uuid NOT NULL REFERENCES market.optionomics_feature_snapshot(feature_snapshot_id),
  observation_id uuid NOT NULL REFERENCES market.optionomics_raw_observation(observation_id),
  observation_role text NOT NULL CHECK(observation_role IN ('PRIMARY_CHAIN','CONTEXT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(feature_snapshot_id,observation_id)
);

CREATE INDEX ix_optionomics_feature_observation_link_observation
  ON market.optionomics_feature_observation_link(observation_id);

CREATE TRIGGER reject_immutable_mutation
BEFORE UPDATE OR DELETE ON market.optionomics_feature_observation_link
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('030_optionomics_context_lineage',repeat('0',64));

COMMIT;
