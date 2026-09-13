DO $$ BEGIN
  IF to_regclass('research.theta_paper_active_baseline_receipt') IS NULL
    OR to_regclass('research.theta_near_miss_reevaluation_event') IS NULL THEN
    RAISE EXCEPTION 'paper active baseline evidence tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='research' AND c.relname='theta_paper_active_baseline_receipt'
      AND t.tgname='reject_immutable_mutation' AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'baseline receipts must be immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='research' AND c.relname='theta_near_miss_reevaluation_event'
      AND t.tgname='reject_immutable_mutation' AND NOT t.tgisinternal
  ) THEN RAISE EXCEPTION 'near miss events must be immutable'; END IF;
END $$;
