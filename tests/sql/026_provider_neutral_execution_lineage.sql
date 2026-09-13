DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='order_intent' AND column_name='quote_semantics') THEN
    RAISE EXCEPTION 'provider-neutral quote semantics missing';
  END IF;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,
      quote_source,quote_feed,quote_semantics,quote_content_hash)
    VALUES('invalid-research-quote','PROPOSED','OPTION','sell',1,'OPTIONOMICS','SESSION',
      'SESSION_RECORDED_RESEARCH',repeat('a',64));
    RAISE EXCEPTION 'research quote semantics were accepted for execution';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,
      quote_source,quote_feed,quote_semantics,quote_content_hash)
    VALUES('invalid-provider-stock','PROPOSED','STOCK','sell',1,'OTHER','SIP',
      'TRUSTED_TWO_SIDED_ORDER_PRICING',repeat('a',64));
    RAISE EXCEPTION 'non-Alpaca stock lineage was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 'provider-neutral execution lineage invariants passed' AS result;
