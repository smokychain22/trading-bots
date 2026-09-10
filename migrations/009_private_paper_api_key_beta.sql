BEGIN;

ALTER TABLE copy.follower_account
  DROP CONSTRAINT IF EXISTS follower_account_connection_method_check;

ALTER TABLE copy.follower_account
  ADD CONSTRAINT follower_account_connection_method_check
  CHECK (connection_method IN ('ALPACA_OAUTH', 'PAPER_API_KEY_PRIVATE_BETA')),
  ADD COLUMN IF NOT EXISTS equity numeric(24,8),
  ADD COLUMN IF NOT EXISTS open_position_count integer,
  ADD COLUMN IF NOT EXISTS open_order_count integer,
  ADD COLUMN IF NOT EXISTS market_is_open boolean;

INSERT INTO core.schema_migration (version, checksum)
VALUES ('009_private_paper_api_key_beta', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
