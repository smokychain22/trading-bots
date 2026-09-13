DO $$
BEGIN
  IF to_regclass('trade.execution_price_event') IS NULL THEN
    RAISE EXCEPTION 'execution price event table missing';
  END IF;
  IF to_regclass('trade.transaction_cost_analysis') IS NULL THEN
    RAISE EXCEPTION 'transaction cost analysis table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='execution_price_event'
      AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'execution price events are mutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='trade' AND event_object_table='transaction_cost_analysis'
      AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'TCA rows are mutable';
  END IF;
END $$;

SELECT 'execution pricing and TCA invariants passed' AS result;
