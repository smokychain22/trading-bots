BEGIN;
DO $$
BEGIN
  IF to_regclass('ops.runtime_worker_cycle') IS NULL OR
     to_regclass('trade.broker_reconciliation_snapshot') IS NULL OR
     to_regclass('trade.unmatched_broker_fact') IS NULL OR
     to_regclass('research.theta_replay_observation') IS NULL OR
     to_regclass('research.theta_replay_outcome_label') IS NULL THEN
    RAISE EXCEPTION 'autonomous runtime evidence tables missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ops' AND table_name='scheduler_checkpoint' AND column_name='lease_acquired_at'
  ) THEN RAISE EXCEPTION 'scheduler acquisition evidence missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='research' AND trigger_name='reject_immutable_mutation'
      AND event_object_table='theta_replay_observation'
  ) THEN RAISE EXCEPTION 'replay observations are not append-only'; END IF;

  BEGIN
    INSERT INTO trade.broker_reconciliation_snapshot(
      connection_id,correlation_id,environment,broker_host,observed_at,data_quality,payload_hash)
    VALUES(gen_random_uuid(),'bad','LIVE','api.alpaca.markets',now(),'GOOD',repeat('a',64));
    RAISE EXCEPTION 'live broker reconciliation accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;
END $$;
ROLLBACK;
