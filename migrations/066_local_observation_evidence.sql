BEGIN;

CREATE TABLE IF NOT EXISTS ops.local_observation_evidence (
  envelope_id uuid PRIMARY KEY,
  decision_cycle_id text NOT NULL,
  snapshot_id text NOT NULL,
  decision_as_of timestamptz NOT NULL,
  source_sha char(40) NOT NULL CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  worker_id text NOT NULL,
  sequence_number integer NOT NULL CHECK(sequence_number >= 0),
  payload_type text NOT NULL,
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json) IN ('object','array')),
  payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  previous_envelope_hash char(64),
  envelope_hash char(64) NOT NULL UNIQUE CHECK(envelope_hash ~ '^[0-9a-f]{64}$'),
  provider_observed_at_json jsonb NOT NULL CHECK(jsonb_typeof(provider_observed_at_json)='object'),
  received_at timestamptz NOT NULL,
  computed_at timestamptz NOT NULL,
  local_persistence_state text NOT NULL CHECK(local_persistence_state='BACKFILLED_POSTGRES'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(decision_cycle_id,sequence_number),
  CHECK(computed_at >= decision_as_of)
);
CREATE INDEX IF NOT EXISTS ix_local_observation_evidence_cycle
  ON ops.local_observation_evidence(decision_cycle_id,sequence_number);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON ops.local_observation_evidence;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.local_observation_evidence
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('066_local_observation_evidence',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
