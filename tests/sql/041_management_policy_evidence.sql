DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='management_action_frontier' AND column_name='policy_version'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='management_action_frontier' AND column_name='policy_evidence_hash'
  ) THEN
    RAISE EXCEPTION 'management policy lineage columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.management_action_frontier'::regclass
      AND conname='management_policy_evidence_shape'
  ) THEN
    RAISE EXCEPTION 'management policy evidence shape constraint is missing';
  END IF;
END $$;
