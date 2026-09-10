\set ON_ERROR_STOP on
BEGIN;

INSERT INTO iam.workspace(workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000701', 'connection-readiness-test');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'copy' AND table_name = 'follower_account'
      AND column_name = 'connection_method'
  ) THEN
    RAISE EXCEPTION 'connection_method is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'copy' AND table_name = 'follower_account'
      AND column_name = 'last_verified_at'
  ) THEN
    RAISE EXCEPTION 'last_verified_at is missing';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO copy.follower_account(
      workspace_id, provider_account_ref, oauth_secret_ref, connection_method
    ) VALUES (
      '00000000-0000-0000-0000-000000000701',
      'invalid-method-test', 'vault:test', 'ALPACA_PAPER_API_KEY_BETA'
    );
    RAISE EXCEPTION 'raw-key follower connection method was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
