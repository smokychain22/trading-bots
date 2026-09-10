BEGIN;

ALTER TABLE copy.follower_account
  ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'ALPACA_OAUTH'
    CHECK (connection_method = 'ALPACA_OAUTH'),
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'CONNECTED'
    CHECK (connection_status IN ('CONNECTED', 'NEEDS_ATTENTION', 'REVOKED')),
  ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

UPDATE copy.follower_account
SET last_verified_at = COALESCE(last_verified_at, last_broker_sync_at),
    connection_status = CASE
      WHEN disconnected_at IS NOT NULL THEN 'REVOKED'
      ELSE connection_status
    END;

CREATE INDEX IF NOT EXISTS ix_follower_account_connection_health
  ON copy.follower_account(connection_status, last_verified_at DESC)
  WHERE disconnected_at IS NULL;

INSERT INTO core.schema_migration (version, checksum)
VALUES ('007_connection_readiness', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
