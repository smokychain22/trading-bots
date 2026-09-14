BEGIN;

ALTER TABLE ops.runtime_worker_status
  DROP CONSTRAINT IF EXISTS runtime_worker_status_runtime_mode_check;
ALTER TABLE ops.runtime_worker_status
  DROP CONSTRAINT IF EXISTS runtime_worker_status_execution_gate_check;
ALTER TABLE ops.runtime_worker_status
  DROP CONSTRAINT IF EXISTS runtime_worker_status_state_check;

UPDATE ops.runtime_worker_status
SET runtime_mode = 'MASTER_THETA_PAPER',
    execution_gate = 'EXTERNAL_QUOTE_BLOCKER',
    state = CASE
      WHEN state = 'WAITING_FOR_MARKET' THEN 'MASTER_PAPER_MARKET_CLOSED'
      WHEN state = 'RECONCILING' THEN 'MASTER_PAPER_RECONCILING'
      WHEN state = 'SHADOW_RUNNING' THEN 'MASTER_PAPER_QUOTE_BLOCKED'
      WHEN state = 'STARTING' THEN 'MASTER_PAPER_STARTING'
      WHEN state = 'DEGRADED' THEN 'MASTER_PAPER_PROVIDER_DEGRADED'
      ELSE state
    END,
    updated_at = now();

UPDATE ops.runtime_worker_lease
SET lease_key = 'THETA_MASTER_PAPER_RUNTIME'
WHERE lease_key = 'THETA_MASTER_SHADOW_COLLECTION';

UPDATE ops.runtime_worker_status
SET lease_key = 'THETA_MASTER_PAPER_RUNTIME'
WHERE lease_key = 'THETA_MASTER_SHADOW_COLLECTION';

ALTER TABLE ops.runtime_worker_status
  ADD CONSTRAINT runtime_worker_status_runtime_mode_check
  CHECK (runtime_mode IN ('MASTER_THETA_PAPER','THETA_LOCAL_SHADOW','THETA_VERCEL_SHADOW'));
ALTER TABLE ops.runtime_worker_status
  ADD CONSTRAINT runtime_worker_status_execution_gate_check
  CHECK (execution_gate IN ('LOCKED','EXTERNAL_QUOTE_BLOCKER'));
ALTER TABLE ops.runtime_worker_status
  ADD CONSTRAINT runtime_worker_status_state_check
  CHECK (state IN (
    'MASTER_PAPER_STARTING','MASTER_PAPER_RECONCILING','MASTER_PAPER_ACTIVE',
    'MASTER_PAPER_MARKET_CLOSED','MASTER_PAPER_QUOTE_BLOCKED','MASTER_PAPER_RISK_BLOCKED',
    'MASTER_PAPER_PROVIDER_DEGRADED','MASTER_PAPER_PAUSED_BY_KILL_SWITCH',
    'OFFLINE','STOPPING','ERROR'
  ));

INSERT INTO core.schema_migration(version, checksum)
VALUES ('033_master_paper_runtime', repeat('0', 64))
ON CONFLICT DO NOTHING;

COMMIT;
