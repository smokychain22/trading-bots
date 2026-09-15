BEGIN;

ALTER TABLE ops.theta_operator_control_event
  DROP CONSTRAINT theta_operator_control_event_command_check,
  ADD CONSTRAINT theta_operator_control_event_command_check CHECK(command IN
    ('PAUSE_NEW_ENTRIES','RESUME_NEW_ENTRIES','EMERGENCY_EXECUTION_LOCK','CLEAR_EMERGENCY_LOCK')),
  ADD COLUMN observed_state_version bigint NOT NULL DEFAULT 0 CHECK(observed_state_version>=0),
  ADD COLUMN state_version bigint,
  ADD COLUMN reason text,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN result text NOT NULL DEFAULT 'APPLIED' CHECK(result IN ('APPLIED','REPLAYED','REJECTED'));
WITH ranked AS (SELECT operator_control_event_id,row_number() OVER(ORDER BY requested_at,created_at,operator_control_event_id) AS version
  FROM ops.theta_operator_control_event)
UPDATE ops.theta_operator_control_event event SET state_version=ranked.version FROM ranked
WHERE event.operator_control_event_id=ranked.operator_control_event_id;
CREATE SEQUENCE ops.theta_operator_state_version_seq;
SELECT setval('ops.theta_operator_state_version_seq',GREATEST(COALESCE((SELECT max(state_version) FROM ops.theta_operator_control_event),0),1));
ALTER TABLE ops.theta_operator_control_event ALTER COLUMN state_version SET NOT NULL,
  ALTER COLUMN state_version SET DEFAULT nextval('ops.theta_operator_state_version_seq'),
  ADD CONSTRAINT theta_operator_control_event_state_version_check CHECK(state_version>=1);
CREATE UNIQUE INDEX ux_theta_operator_control_state_version ON ops.theta_operator_control_event(state_version);

ALTER TABLE research.theta_position_path_checkpoint
  ADD COLUMN evidence_kind text NOT NULL DEFAULT 'RAW_CYCLE_SNAPSHOT'
    CHECK(evidence_kind IN ('RAW_CYCLE_SNAPSHOT','SEMANTIC_PATH_CHECKPOINT')),
  ADD COLUMN checkpoint_reason text NOT NULL DEFAULT 'CYCLE_OBSERVATION';
CREATE INDEX ix_theta_semantic_path_checkpoint ON research.theta_position_path_checkpoint(chain_id,observed_at)
  WHERE evidence_kind='SEMANTIC_PATH_CHECKPOINT';

CREATE TABLE research.optionomics_provider_qualification_receipt(
  qualification_run_id uuid PRIMARY KEY,
  qualification_version text NOT NULL,
  mode text NOT NULL CHECK(mode IN ('SYNTHETIC','REPLAY','REAL_AUTHENTICATED')),
  attempted_at timestamptz NOT NULL,
  credential_identity_ref_hash char(64),
  secret_state text NOT NULL CHECK(secret_state IN ('NOT_CONFIGURED','CONFIGURED_UNVERIFIED','AUTH_VALID','AUTH_INVALID','RATE_LIMITED','TEMPORARILY_UNAVAILABLE','PROVIDER_ERROR')),
  families_json jsonb NOT NULL CHECK(jsonb_typeof(families_json)='array'),
  real_payload_count integer NOT NULL CHECK(real_payload_count>=0),
  stale_capability_count integer NOT NULL CHECK(stale_capability_count>=0),
  evidence_hash char(64) NOT NULL UNIQUE CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research.quote_provider_qualification_receipt(
  qualification_run_id uuid PRIMARY KEY,
  provider text NOT NULL,
  source text NOT NULL,
  entitlement_state text NOT NULL CHECK(entitlement_state IN ('NOT_CONFIGURED','NO_ENTITLEMENT','INDICATIVE_ONLY','ENTITLED_UNVERIFIED','QUALIFIED','STALE','PROVIDER_ERROR')),
  attempted_at timestamptz NOT NULL,
  exact_contract_id text,
  semantics text NOT NULL,
  qualified boolean NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  evidence_hash char(64) NOT NULL UNIQUE CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.theta_alert_event(
  alert_event_id uuid PRIMARY KEY,
  alert_identity text NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  source text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrence_count integer NOT NULL CHECK(occurrence_count>=1),
  state text NOT NULL CHECK(state IN ('ACTIVE','RESOLVED')),
  related_ref text,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alert_identity,last_seen_at)
);
CREATE INDEX ix_theta_alert_active ON ops.theta_alert_event(severity,last_seen_at DESC) WHERE state='ACTIVE';

DO $$ BEGIN
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.optionomics_provider_qualification_receipt
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.quote_provider_qualification_receipt
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON ops.theta_alert_event
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum) VALUES('048_p2f_provider_activation_readiness',repeat('0',64));
COMMIT;
