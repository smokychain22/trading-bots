\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='market' AND table_name='optionomics_raw_observation'
      AND column_name='credential_identity_ref_hash'
  ) THEN
    RAISE EXCEPTION 'Optionomics credential identity reference missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema='market' AND constraint_name='optionomics_request_time_order'
  ) THEN
    RAISE EXCEPTION 'Optionomics request provenance time invariant missing';
  END IF;
END $$;
ROLLBACK;
