DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='trade.execution_account'::regclass
      AND conname='execution_account_paper_only_check'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'PAPER-only execution account constraint is missing or unvalidated';
  END IF;

  BEGIN
    INSERT INTO trade.execution_account(account_kind,environment,provider_account_ref_hash,provider_account_ref_masked)
    VALUES('MASTER_API_KEY','LIVE',encode(digest(gen_random_uuid()::text,'sha256'),'hex'),'masked');
    RAISE EXCEPTION 'LIVE execution account was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
