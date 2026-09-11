BEGIN;
DO $$
BEGIN
  IF to_regclass('trade.management_decision') IS NULL OR
     to_regclass('trade.strategy_route') IS NULL OR
     to_regclass('trade.shadow_opportunity') IS NULL OR
     to_regclass('trade.management_opportunity') IS NULL OR
     to_regclass('trade.lifecycle_transition') IS NULL OR
     to_regclass('ops.scheduler_checkpoint') IS NULL THEN
    RAISE EXCEPTION 'runtime persistence tables missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND trigger_name='reject_immutable_mutation'
      AND event_object_table='shadow_opportunity'
  ) THEN RAISE EXCEPTION 'shadow opportunity is not append-only'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='decision' AND column_name='aegis_action' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'decision cannot preserve UNKNOWN AEGIS'; END IF;

  BEGIN
    INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,max_attempts,status,lease_owner)
    VALUES ('bad-lease','ORDER_RECONCILIATION','one',3,'LEASED','worker');
    RAISE EXCEPTION 'invalid lease accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO ops.scheduler_checkpoint(job_id,job_kind,correlation_key,max_attempts,status)
  VALUES ('valid-pending','ORDER_RECONCILIATION','one',3,'PENDING');
END $$;
ROLLBACK;
