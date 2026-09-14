BEGIN;

DO $$
BEGIN
  IF to_regclass('trade.canonical_strategy_frontier') IS NULL THEN
    RAISE EXCEPTION 'trade.canonical_strategy_frontier missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='canonical_strategy_frontier'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'canonical strategy frontier immutable trigger missing';
  END IF;
END $$;

ROLLBACK;
