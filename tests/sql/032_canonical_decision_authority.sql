DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='canonical_strategy_frontier'
      AND column_name='decision_authority_version' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'canonical frontier decision authority version missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='decision'
      AND column_name='decision_authority_version'
  ) THEN RAISE EXCEPTION 'decision authority version missing from decision ledger'; END IF;
END $$;
