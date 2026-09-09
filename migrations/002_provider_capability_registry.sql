BEGIN;

DO $$ BEGIN
  CREATE TYPE core.provider_code AS ENUM ('ALPACA', 'OPTIONOMICS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS iam.workspace (
  workspace_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.provider_connection (
  provider_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES iam.workspace(workspace_id),
  provider_code core.provider_code NOT NULL,
  environment text NOT NULL,
  secret_ref text NOT NULL,
  masked_label text,
  status text NOT NULL,
  connected_at timestamptz,
  last_verified_at timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(workspace_id, provider_code, environment)
);

CREATE TABLE IF NOT EXISTS core.provider_capability (
  provider_connection_id uuid NOT NULL REFERENCES core.provider_connection(provider_connection_id) ON DELETE CASCADE,
  capability_code text NOT NULL,
  entitlement text,
  status text NOT NULL CHECK (status IN ('GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED')),
  checked_at timestamptz NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(provider_connection_id, capability_code)
);

CREATE TABLE IF NOT EXISTS core.provider_operation_registry (
  provider_code core.provider_code NOT NULL,
  operation_alias text NOT NULL,
  method text NOT NULL,
  path_or_operation_id text NOT NULL,
  contract_version text NOT NULL,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  notes text,
  PRIMARY KEY(provider_code, operation_alias, contract_version)
);

INSERT INTO core.schema_migration (version, checksum)
VALUES ('002_provider_capability_registry', '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT (version) DO NOTHING;

COMMIT;
