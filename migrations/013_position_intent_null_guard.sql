BEGIN;

-- CHECK accepts NULL. Explicitly require a value for every OPTION row.
-- Do not infer or backfill intent for historical ambiguous records.
ALTER TABLE trade.order_intent DROP CONSTRAINT ck_order_intent_position_intent;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_position_intent CHECK (
  (instrument_type = 'OPTION' AND position_intent IS NOT NULL
    AND position_intent IN ('BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE')
    AND (side = position_intent OR
      (side = 'buy' AND position_intent IN ('BUY_TO_OPEN','BUY_TO_CLOSE')) OR
      (side = 'sell' AND position_intent IN ('SELL_TO_OPEN','SELL_TO_CLOSE'))))
  OR (instrument_type = 'STOCK' AND position_intent IS NULL AND side IN ('buy','sell'))
);

INSERT INTO core.schema_migration(version, checksum)
VALUES ('013_position_intent_null_guard', repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
