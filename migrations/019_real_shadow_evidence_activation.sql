BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_shadow_scan_run (
  scan_id uuid PRIMARY KEY,
  mode text NOT NULL CHECK(mode='THETA_SHADOW_ONLY'),
  contract_version text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL CHECK(finished_at >= started_at),
  universe_version text NOT NULL,
  lattice_version text NOT NULL,
  strategy_version text NOT NULL,
  branches_json jsonb NOT NULL CHECK(jsonb_typeof(branches_json)='array'),
  eligible_symbols_json jsonb NOT NULL CHECK(jsonb_typeof(eligible_symbols_json)='array'),
  max_underlyings integer NOT NULL CHECK(max_underlyings > 0),
  symbols_attempted integer NOT NULL CHECK(symbols_attempted >= 0),
  symbols_completed integer NOT NULL CHECK(symbols_completed >= 0 AND symbols_completed <= symbols_attempted),
  candidate_count integer NOT NULL CHECK(candidate_count >= 0),
  completeness_state text NOT NULL CHECK(completeness_state IN ('COMPLETE','PARTIAL','INTERRUPTED','PROVIDER_LIMITED','DATA_INSUFFICIENT')),
  missing_scope_json jsonb NOT NULL CHECK(jsonb_typeof(missing_scope_json)='array'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.theta_shadow_scan_member (
  scan_id uuid NOT NULL REFERENCES research.theta_shadow_scan_run(scan_id),
  symbol text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal > 0),
  status text NOT NULL CHECK(status IN ('COMPLETED','FAILED')),
  error_code text,
  fusion_snapshot_id uuid REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  candidate_set_id uuid REFERENCES trade.candidate_set(candidate_set_id),
  candidate_count integer NOT NULL CHECK(candidate_count >= 0),
  contracts_complete boolean,
  quotes_complete boolean,
  PRIMARY KEY(scan_id,symbol),
  UNIQUE(scan_id,ordinal)
);

CREATE TABLE IF NOT EXISTS research.theta_execution_observation_job (
  observation_job_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id),
  contract_symbol text NOT NULL,
  horizon_code text NOT NULL CHECK(horizon_code IN ('1M','5M','30M','EOD')),
  horizon_version text NOT NULL,
  target_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','OBSERVED','MISSED')),
  resolved_at timestamptz,
  quote_observation_id uuid REFERENCES market.execution_quote_observation(quote_observation_id),
  missing_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id,horizon_version,horizon_code),
  CHECK((status='PENDING' AND resolved_at IS NULL AND quote_observation_id IS NULL AND missing_reason IS NULL)
    OR (status='OBSERVED' AND resolved_at IS NOT NULL AND quote_observation_id IS NOT NULL AND missing_reason IS NULL)
    OR (status='MISSED' AND resolved_at IS NOT NULL AND quote_observation_id IS NULL AND missing_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_theta_observation_jobs_due
  ON research.theta_execution_observation_job(target_at,observation_job_id) WHERE status='PENDING';

DO $$ BEGIN
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_shadow_scan_run;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_shadow_scan_run
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
  DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.theta_shadow_scan_member;
  CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.theta_shadow_scan_member
    FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('019_real_shadow_evidence_activation',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
