DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'runtime_worker_status_state_check'
      AND pg_get_constraintdef(oid) LIKE '%MASTER_PAPER_NEW_RISK_LOCKED%'
  ) THEN
    RAISE EXCEPTION 'runtime worker state constraint does not distinguish a control lock from a quote blocker';
  END IF;
END $$;
