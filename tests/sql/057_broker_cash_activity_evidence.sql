DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='fill' AND column_name='fees'
      AND is_nullable='YES' AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'unknown fill fees are coerced to zero';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='trade' AND table_name='broker_activity_fact'
        AND column_name IN ('net_amount','per_share_amount')
        AND is_nullable='YES' AND column_default IS NULL) <> 2 THEN
    RAISE EXCEPTION 'nullable broker cash activity evidence columns missing';
  END IF;
END $$;

SELECT 'broker cash activity evidence invariants passed' AS result;
