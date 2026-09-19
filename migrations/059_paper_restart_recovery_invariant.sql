BEGIN;

-- A restored or partially imported database can retain the migration registry
-- while losing a non-table object. Recreate the restart recovery index
-- idempotently so ambiguous and partial submissions remain discoverable after
-- a worker restart.
CREATE INDEX IF NOT EXISTS ix_order_intent_restart_recovery
  ON trade.order_intent(execution_account_id, status, updated_at)
  WHERE status IN ('SUBMITTING', 'UNKNOWN_SUBMISSION', 'RECONCILING', 'PARTIAL');

INSERT INTO core.schema_migration(version,checksum)
VALUES('059_paper_restart_recovery_invariant',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
