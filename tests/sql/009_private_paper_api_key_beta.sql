\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'copy' AND table_name = 'follower_account' AND column_name = 'equity'
  ) THEN RAISE EXCEPTION 'equity is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'copy' AND table_name = 'follower_account' AND column_name = 'open_position_count'
  ) THEN RAISE EXCEPTION 'open_position_count is missing'; END IF;
END $$;

INSERT INTO iam.workspace(workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000901', 'private-beta-method-test');

INSERT INTO copy.follower_account(
  workspace_id, provider_account_ref, oauth_secret_ref, connection_method
) VALUES (
  '00000000-0000-0000-0000-000000000901',
  'paper-private-beta', 'vault:encrypted-only', 'PAPER_API_KEY_PRIVATE_BETA'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO copy.follower_account(
      workspace_id, provider_account_ref, oauth_secret_ref, connection_method
    ) VALUES (
      '00000000-0000-0000-0000-000000000901',
      'live-key-method', 'vault:invalid', 'ALPACA_LIVE_API_KEY'
    );
    RAISE EXCEPTION 'live connection method was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
