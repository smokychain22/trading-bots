BEGIN;
DO $$
DECLARE intent text;
BEGIN
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,instrument_type,side,quantity)
    VALUES ('test-null-intent','OPTION','sell',0);
    RAISE EXCEPTION 'NULL option intent was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,instrument_type,side,position_intent,quantity)
    VALUES ('test-mismatch-intent','OPTION','buy','SELL_TO_OPEN',1);
    RAISE EXCEPTION 'Contradictory side was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO trade.order_intent(client_order_id,instrument_type,side,position_intent,quantity)
    VALUES ('test-stock-intent','STOCK','sell','SELL_TO_CLOSE',1);
    RAISE EXCEPTION 'Option intent on stock was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  FOREACH intent IN ARRAY ARRAY['BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE'] LOOP
    INSERT INTO trade.order_intent(client_order_id,instrument_type,side,position_intent,quantity)
    VALUES ('test-valid-'||intent,'OPTION',lower(split_part(intent,'_',1)),intent,0);
  END LOOP;
  INSERT INTO trade.order_intent(client_order_id,instrument_type,side,quantity)
  VALUES ('test-valid-stock','STOCK','sell',0);
END $$;
ROLLBACK;
