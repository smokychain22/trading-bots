BEGIN;

CREATE TABLE IF NOT EXISTS ops.paper_execution_authorization_event (
  authorization_event_id uuid PRIMARY KEY,
  account_role text NOT NULL CHECK (account_role = 'MASTER_THETA_PAPER'),
  environment text NOT NULL CHECK (environment = 'PAPER'),
  master_submission_authorized boolean NOT NULL CHECK (master_submission_authorized),
  follower_submission_authorized boolean NOT NULL CHECK (follower_submission_authorized = false),
  live_money_authorized boolean NOT NULL CHECK (live_money_authorized = false),
  authorization_scope_json jsonb NOT NULL CHECK (jsonb_typeof(authorization_scope_json) = 'object'),
  directive_hash char(64) NOT NULL UNIQUE CHECK (directive_hash ~ '^[0-9a-f]{64}$'),
  authorized_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ops.paper_execution_control
  ADD COLUMN IF NOT EXISTS authorization_event_id uuid
    REFERENCES ops.paper_execution_authorization_event(authorization_event_id);

CREATE TRIGGER reject_immutable_mutation
  BEFORE UPDATE OR DELETE ON ops.paper_execution_authorization_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version, checksum)
VALUES ('054_master_paper_authorization', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
