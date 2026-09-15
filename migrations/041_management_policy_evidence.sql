BEGIN;

ALTER TABLE trade.management_action_frontier
  ADD COLUMN policy_version text,
  ADD COLUMN policy_evidence_hash char(64),
  ADD CONSTRAINT management_policy_evidence_shape CHECK (
    (policy_version IS NULL AND policy_evidence_hash IS NULL) OR
    (length(btrim(policy_version)) > 0 AND policy_evidence_hash ~ '^[0-9a-f]{64}$')
  );

INSERT INTO core.schema_migration(version,checksum)
VALUES('041_management_policy_evidence',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
