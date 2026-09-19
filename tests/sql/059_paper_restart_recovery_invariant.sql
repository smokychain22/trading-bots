DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='trade' AND indexname='ix_order_intent_restart_recovery'
  ) THEN
    RAISE EXCEPTION 'restart recovery index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.schema_migration
    WHERE version='059_paper_restart_recovery_invariant'
  ) THEN
    RAISE EXCEPTION 'migration 059 is missing';
  END IF;
END;
$$;
