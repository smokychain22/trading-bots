DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid='trade.order_intent'::regclass AND conname='ck_order_intent_quote_lineage';
  IF definition IS NULL OR position('PAPER_INDICATIVE_REFERENCE' in definition)=0
    OR position('INDICATIVE' in definition)=0 THEN
    RAISE EXCEPTION 'Paper indicative order-intent lineage constraint missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid='trade.execution_price_event'::regclass
    AND conname='execution_price_event_source_semantics_check';
  IF definition IS NULL OR position('PAPER_INDICATIVE_REFERENCE' in definition)=0 THEN
    RAISE EXCEPTION 'Paper indicative execution evidence semantics missing';
  END IF;
END $$;
