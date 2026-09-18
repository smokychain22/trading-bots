DO $$
BEGIN
  IF to_regclass('trade.option_partial_close_realization') IS NULL THEN
    RAISE EXCEPTION 'terminal partial-close realization table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='option_partial_close_realization'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'terminal partial-close realization is mutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema='trade' AND table_name='option_partial_close_realization'
      AND constraint_type='UNIQUE'
  ) THEN
    RAISE EXCEPTION 'terminal partial-close replay guard missing';
  END IF;
END $$;

SELECT 'terminal partial-close accounting invariants passed' AS result;
