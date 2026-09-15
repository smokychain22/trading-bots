BEGIN;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid='research.theta_outcome_subject'::regclass AND c.contype='u'
    AND pg_get_constraintdef(c.oid) LIKE '%subject_id, label_type, horizon_id, resolver_contract_version%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE research.theta_outcome_subject DROP CONSTRAINT %I',constraint_name);
  END IF;
END $$;

ALTER TABLE research.theta_outcome_subject
  DROP CONSTRAINT IF EXISTS theta_outcome_subject_decision_identity;
ALTER TABLE research.theta_outcome_subject
  ADD CONSTRAINT theta_outcome_subject_decision_identity
  UNIQUE(subject_id,label_type,decision_timestamp,horizon_id,resolver_contract_version);

INSERT INTO core.schema_migration(version,checksum)
VALUES('045_outcome_subject_decision_identity',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
