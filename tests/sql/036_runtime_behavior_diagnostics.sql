DO $$ BEGIN
  IF to_regclass('research.theta_runtime_behavior_diagnostic') IS NULL THEN
    RAISE EXCEPTION 'runtime behavior diagnostic table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='research.theta_runtime_behavior_diagnostic'::regclass
      AND tgname='reject_immutable_mutation' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'runtime behavior diagnostic immutability trigger missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.theta_runtime_behavior_diagnostic'::regclass
      AND pg_get_constraintdef(oid) LIKE '%NO_EMPIRICAL_FREQUENCY_THRESHOLD%'
  ) THEN RAISE EXCEPTION 'runtime behavior threshold policy guard missing'; END IF;
END $$;
