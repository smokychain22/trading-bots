BEGIN;

ALTER TABLE ops.runtime_worker_status
  DROP CONSTRAINT IF EXISTS runtime_worker_status_state_check;

UPDATE ops.runtime_worker_status
SET state = 'MASTER_PAPER_NEW_RISK_LOCKED',
    failure_reason = NULL,
    updated_at = now()
WHERE state = 'MASTER_PAPER_QUOTE_BLOCKED'
  AND execution_gate = 'LOCKED';

ALTER TABLE ops.runtime_worker_status
  ADD CONSTRAINT runtime_worker_status_state_check
  CHECK (state IN (
    'MASTER_PAPER_STARTING','MASTER_PAPER_RECONCILING','MASTER_PAPER_ACTIVE',
    'MASTER_PAPER_MARKET_CLOSED','MASTER_PAPER_QUOTE_BLOCKED','MASTER_PAPER_RISK_BLOCKED',
    'MASTER_PAPER_PROVIDER_DEGRADED','MASTER_PAPER_PAUSED_BY_KILL_SWITCH',
    'MASTER_PAPER_NEW_RISK_LOCKED','OFFLINE','STOPPING','ERROR'
  ));

INSERT INTO core.schema_migration(version, checksum)
VALUES ('056_paper_runtime_gate_semantics', repeat('0', 64))
ON CONFLICT DO NOTHING;

COMMIT;
