DO $$
BEGIN
  IF to_regclass('trade.canonical_strategy_branch_evidence') IS NULL
    OR to_regclass('trade.canonical_strategy_candidate_evidence') IS NULL THEN
    RAISE EXCEPTION 'cross-branch candidate evidence tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='canonical_strategy_branch_evidence'
      AND trigger_name='reject_immutable_mutation'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='canonical_strategy_candidate_evidence'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'cross-branch candidate evidence is not immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.canonical_strategy_candidate_evidence'::regclass
      AND conname='canonical_candidate_execution_locked'
  ) THEN
    RAISE EXCEPTION 'cross-branch candidate evidence can authorize execution';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.canonical_strategy_candidate_evidence'::regclass
      AND conname='canonical_candidate_defined_risk_two_legs'
  ) THEN
    RAISE EXCEPTION 'defined-risk two-leg shape is not enforced';
  END IF;
END $$;
