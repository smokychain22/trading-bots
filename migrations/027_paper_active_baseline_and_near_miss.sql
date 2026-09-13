BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_paper_active_baseline_receipt (
  baseline_receipt_id uuid PRIMARY KEY,
  scan_id uuid NOT NULL UNIQUE REFERENCES research.theta_shadow_scan_run(scan_id),
  decision_id uuid REFERENCES trade.decision(decision_id),
  selected_candidate_id uuid REFERENCES trade.candidate(candidate_id),
  observed_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  empirical_ev_ready boolean NOT NULL CHECK(empirical_ev_ready=false),
  execution_authorized boolean NOT NULL CHECK(execution_authorized=false),
  candidate_assessments_json jsonb NOT NULL CHECK(jsonb_typeof(candidate_assessments_json)='array'),
  pareto_frontier_candidate_ids_json jsonb NOT NULL CHECK(jsonb_typeof(pareto_frontier_candidate_ids_json)='array'),
  why_not_wait_json jsonb NOT NULL CHECK(jsonb_typeof(why_not_wait_json)='object'),
  reason_codes_json jsonb NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.theta_near_miss_reevaluation_event (
  near_miss_event_id uuid PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES research.theta_shadow_scan_run(scan_id),
  candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id),
  event_type text NOT NULL CHECK(event_type IN ('QUEUED','TRIGGERED','RESOLVED','SUPERSEDED')),
  trigger_kind text NOT NULL CHECK(trigger_kind IN ('SCHEDULED_REFRESH','QUOTE_REFRESH','DATA_RECOVERY','ACCOUNT_OR_RISK_CHANGE','ALTERNATIVE_REEVALUATION')),
  occurred_at timestamptz NOT NULL,
  correlation_key text NOT NULL,
  reason_codes_json jsonb NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  trigger_payload_json jsonb NOT NULL CHECK(jsonb_typeof(trigger_payload_json)='object'),
  policy_version text NOT NULL,
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_theta_near_miss_latest
  ON research.theta_near_miss_reevaluation_event(candidate_id,occurred_at DESC,created_at DESC);

DO $$ BEGIN
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_paper_active_baseline_receipt;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_paper_active_baseline_receipt
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_near_miss_reevaluation_event;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_near_miss_reevaluation_event
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('027_paper_active_baseline_and_near_miss',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
