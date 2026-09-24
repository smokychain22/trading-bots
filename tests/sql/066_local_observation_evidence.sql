DO $$
BEGIN
  IF to_regclass('ops.local_observation_evidence') IS NULL THEN
    RAISE EXCEPTION 'ops.local_observation_evidence missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='ops' AND table_name='local_observation_evidence'
      AND constraint_type='UNIQUE'
  ) THEN RAISE EXCEPTION 'local evidence idempotency constraint missing'; END IF;
END $$;
