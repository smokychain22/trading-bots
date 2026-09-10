BEGIN;

CREATE TABLE IF NOT EXISTS iam.customer_identity (
  customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(trim(email_normalized))),
  password_hash text NOT NULL CHECK (length(password_hash) >= 64),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iam.customer_session (
  session_hash char(64) PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES iam.customer_identity(customer_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS ix_customer_session_customer
  ON iam.customer_session(customer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS copy.alpaca_oauth_state (
  state_hash char(64) PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES iam.customer_identity(customer_id) ON DELETE CASCADE,
  return_path text NOT NULL DEFAULT '/bots/theta/copy' CHECK (return_path LIKE '/%'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS ix_alpaca_oauth_state_customer
  ON copy.alpaca_oauth_state(customer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS copy.alpaca_oauth_token (
  token_secret_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES iam.customer_identity(customer_id) ON DELETE CASCADE,
  key_ref text NOT NULL CHECK (length(trim(key_ref)) > 0),
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alpaca_oauth_token_active_customer
  ON copy.alpaca_oauth_token(customer_id) WHERE revoked_at IS NULL;

ALTER TABLE copy.follower_account
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES iam.customer_identity(customer_id),
  ADD COLUMN IF NOT EXISTS token_secret_id uuid REFERENCES copy.alpaca_oauth_token(token_secret_id),
  ADD COLUMN IF NOT EXISTS account_status text,
  ADD COLUMN IF NOT EXISTS buying_power numeric(24,8),
  ADD COLUMN IF NOT EXISTS cash numeric(24,8),
  ADD COLUMN IF NOT EXISTS options_buying_power numeric(24,8),
  ADD COLUMN IF NOT EXISTS options_approved_level integer,
  ADD COLUMN IF NOT EXISTS options_trading_level integer,
  ADD COLUMN IF NOT EXISTS restrictions jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS ux_follower_account_active_customer
  ON copy.follower_account(customer_id) WHERE disconnected_at IS NULL;

CREATE TABLE IF NOT EXISTS copy.customer_participation (
  customer_id uuid PRIMARY KEY REFERENCES iam.customer_identity(customer_id) ON DELETE CASCADE,
  follower_account_id uuid REFERENCES copy.follower_account(follower_account_id),
  bot_id text NOT NULL DEFAULT 'theta' CHECK (bot_id = 'theta'),
  state text NOT NULL DEFAULT 'SETUP'
    CHECK (state IN ('SETUP', 'READY', 'ACTIVE', 'STOP_NEW_ENTRIES', 'DISCONNECTED', 'BLOCKED', 'RECONCILING')),
  allocation_usd numeric(24,8) CHECK (allocation_usd >= 0),
  policy_version text NOT NULL DEFAULT 'theta-copy-policy-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.provider_verification (
  provider_verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL CHECK (provider_code IN ('ALPACA', 'OPTIONOMICS')),
  environment text NOT NULL CHECK (environment = 'PAPER'),
  state text NOT NULL CHECK (state IN ('GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED')),
  safe_result jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_provider_verification_latest
  ON ops.provider_verification(provider_code, verified_at DESC);

INSERT INTO core.schema_migration (version, checksum)
VALUES ('006_customer_identity_and_alpaca_oauth', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
