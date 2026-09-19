BEGIN;

-- Reassert PAPER-only storage even when a restored database already had the
-- table before migration 008 ran. The original CREATE TABLE IF NOT EXISTS
-- could not add its inline check to a pre-existing relation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.execution_account'::regclass
      AND conname='execution_account_paper_only_check'
  ) THEN
    ALTER TABLE trade.execution_account
      ADD CONSTRAINT execution_account_paper_only_check
      CHECK (environment='PAPER') NOT VALID;
  END IF;
END;
$$;

ALTER TABLE trade.execution_account
  VALIDATE CONSTRAINT execution_account_paper_only_check;

INSERT INTO core.schema_migration(version,checksum)
VALUES('060_execution_account_paper_only_invariant',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
