BEGIN;

ALTER TABLE copy.follower_account ADD COLUMN IF NOT EXISTS account_role text
  NOT NULL DEFAULT 'FOLLOWER_THETA_PAPER'
  CHECK (account_role IN ('MASTER_THETA_PAPER', 'FOLLOWER_THETA_PAPER'));

-- Identity is global across customers and survives disconnect/key rotation.
-- Existing duplicate identities cause a migration failure, never silent deletion.
CREATE UNIQUE INDEX IF NOT EXISTS ux_paper_broker_identity
  ON copy.follower_account(provider_code, environment, provider_account_ref);
CREATE UNIQUE INDEX IF NOT EXISTS ux_single_theta_master
  ON copy.follower_account(account_role) WHERE account_role = 'MASTER_THETA_PAPER';
CREATE UNIQUE INDEX IF NOT EXISTS ux_execution_broker_identity
  ON trade.execution_account(provider_account_ref_hash);

CREATE TABLE IF NOT EXISTS ops.paper_account_role_event (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  account_role text NOT NULL CHECK (account_role = 'MASTER_THETA_PAPER'),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS reject_immutable_mutation ON ops.paper_account_role_event;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.paper_account_role_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION copy.guard_master_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.account_role = 'MASTER_THETA_PAPER' AND (
    NEW.account_role <> OLD.account_role OR NEW.provider_account_ref <> OLD.provider_account_ref
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
  ) THEN RAISE EXCEPTION 'MASTER_IDENTITY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  IF NEW.account_role = 'MASTER_THETA_PAPER' AND NEW.participation = 'COPY_NEW_AND_MANAGE'
  THEN RAISE EXCEPTION 'MASTER_SELF_COPY_FORBIDDEN' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_master_connection ON copy.follower_account;
CREATE TRIGGER guard_master_connection BEFORE INSERT OR UPDATE ON copy.follower_account
  FOR EACH ROW EXECUTE FUNCTION copy.guard_master_connection();

CREATE OR REPLACE FUNCTION copy.reject_master_copy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role text;
BEGIN
  -- Row locking serializes promotion with policy/event creation.
  SELECT account_role INTO role FROM copy.follower_account
    WHERE follower_account_id = NEW.follower_account_id FOR UPDATE;
  IF role = 'MASTER_THETA_PAPER' THEN
    RAISE EXCEPTION 'MASTER_SELF_COPY_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reject_master_copy ON copy.follower_policy;
CREATE TRIGGER reject_master_copy BEFORE INSERT ON copy.follower_policy
  FOR EACH ROW EXECUTE FUNCTION copy.reject_master_copy();
DROP TRIGGER IF EXISTS reject_master_copy ON copy.follower_copy_event;
CREATE TRIGGER reject_master_copy BEFORE INSERT ON copy.follower_copy_event
  FOR EACH ROW EXECUTE FUNCTION copy.reject_master_copy();

CREATE OR REPLACE FUNCTION copy.guard_master_participation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('READY', 'ACTIVE', 'STOP_NEW_ENTRIES') THEN
    PERFORM 1 FROM copy.follower_account WHERE follower_account_id = NEW.follower_account_id
      AND account_role = 'MASTER_THETA_PAPER' FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'MASTER_SELF_COPY_FORBIDDEN' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_master_participation ON copy.customer_participation;
CREATE TRIGGER guard_master_participation BEFORE INSERT OR UPDATE ON copy.customer_participation
  FOR EACH ROW EXECUTE FUNCTION copy.guard_master_participation();

CREATE OR REPLACE FUNCTION trade.guard_follower_execution_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE connection copy.follower_account%ROWTYPE;
BEGIN
  IF NEW.follower_account_id IS NOT NULL THEN
    SELECT * INTO connection FROM copy.follower_account
      WHERE follower_account_id=NEW.follower_account_id FOR UPDATE;
    IF connection.account_role = 'MASTER_THETA_PAPER' OR
       NEW.provider_account_ref_hash <> encode(digest(connection.provider_account_ref,'sha256'),'hex') THEN
      RAISE EXCEPTION 'FOLLOWER_EXECUTION_IDENTITY_REJECTED' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_follower_execution_identity ON trade.execution_account;
CREATE TRIGGER guard_follower_execution_identity BEFORE INSERT OR UPDATE ON trade.execution_account
  FOR EACH ROW EXECUTE FUNCTION trade.guard_follower_execution_identity();

INSERT INTO core.schema_migration(version, checksum)
VALUES ('010_paper_account_roles', repeat('0',64)) ON CONFLICT (version) DO NOTHING;
COMMIT;
