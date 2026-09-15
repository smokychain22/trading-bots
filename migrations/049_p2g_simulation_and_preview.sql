BEGIN;

CREATE TABLE research.theta_synthetic_lifecycle_receipt(
  simulation_receipt_id uuid PRIMARY KEY,
  scenario_id text NOT NULL,
  simulation_version text NOT NULL,
  simulated_at timestamptz NOT NULL,
  terminal_state text NOT NULL,
  whole_chain_net_pnl numeric NOT NULL,
  capital_days numeric NOT NULL CHECK(capital_days>=0),
  receipt_json jsonb NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  evidence_origin text NOT NULL DEFAULT 'SIMULATED' CHECK(evidence_origin='SIMULATED'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  real_paper_evidence boolean NOT NULL DEFAULT false CHECK(real_paper_evidence=false),
  policy_learning_eligible boolean NOT NULL DEFAULT false CHECK(policy_learning_eligible=false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research.theta_paper_order_preview_receipt(
  preview_receipt_id uuid PRIMARY KEY,
  preview_id text NOT NULL,
  preview_version text NOT NULL,
  previewed_at timestamptz NOT NULL,
  result text NOT NULL CHECK(result IN ('DRY_RUN_READY','DRY_RUN_BLOCKED')),
  blocker_codes text[] NOT NULL,
  receipt_json jsonb NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  receipt_hash char(64) NOT NULL UNIQUE CHECK(receipt_hash ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  submit_to_broker boolean NOT NULL DEFAULT false CHECK(submit_to_broker=false),
  paper_order_created boolean NOT NULL DEFAULT false CHECK(paper_order_created=false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research.optionomics_family_health_observation(
  family_health_id uuid PRIMARY KEY,
  family text NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('GOOD','DEGRADED','STALE','UNKNOWN','INVALID','NOT_ENTITLED')),
  documented boolean NOT NULL,
  endpoint_verified boolean NOT NULL,
  implemented boolean NOT NULL,
  auth_blocked boolean NOT NULL,
  real_payload_captured boolean NOT NULL,
  schema_confirmed boolean NOT NULL,
  qualified boolean NOT NULL,
  sample_count integer NOT NULL CHECK(sample_count>=0),
  missing_field_count integer NOT NULL CHECK(missing_field_count>=0),
  stale_count integer NOT NULL CHECK(stale_count>=0),
  failure_codes text[] NOT NULL,
  observation_json jsonb NOT NULL CHECK(jsonb_typeof(observation_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_synthetic_lifecycle_receipt
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_paper_order_preview_receipt
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.optionomics_family_health_observation
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum) VALUES('049_p2g_simulation_and_preview',repeat('0',64));
COMMIT;
