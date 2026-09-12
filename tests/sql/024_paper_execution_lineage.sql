DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='order_intent' AND column_name='quote_feed') THEN
    RAISE EXCEPTION 'quote_feed lineage column missing';
  END IF;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,
      quote_source,quote_feed,quote_content_hash)
    VALUES('invalid-quote-lineage','PROPOSED','OPTION','sell',1,'OPTIONOMICS','OPRA',repeat('a',64));
    RAISE EXCEPTION 'non-Alpaca execution quote lineage was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,
      quote_source,quote_feed,quote_content_hash)
    VALUES('invalid-option-feed','PROPOSED','OPTION','sell',1,'ALPACA','IEX',repeat('a',64));
    RAISE EXCEPTION 'non-OPRA option quote lineage was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,status,instrument_type,side,quantity,
      quote_source,quote_feed,quote_content_hash)
    VALUES('invalid-stock-feed','PROPOSED','STOCK','sell',1,'ALPACA','OPRA',repeat('a',64));
    RAISE EXCEPTION 'OPRA stock quote lineage was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT 'paper execution lineage invariants passed' AS result;
