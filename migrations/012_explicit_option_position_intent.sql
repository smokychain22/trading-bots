BEGIN;

ALTER TABLE trade.order_intent ADD COLUMN IF NOT EXISTS position_intent text;

ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_position_intent;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_position_intent CHECK (
  (instrument_type = 'OPTION' AND position_intent IN (
    'BUY_TO_OPEN', 'BUY_TO_CLOSE', 'SELL_TO_OPEN', 'SELL_TO_CLOSE'
  )) OR
  (instrument_type = 'STOCK' AND position_intent IS NULL)
);

INSERT INTO core.schema_migration(version, checksum)
VALUES ('012_explicit_option_position_intent', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
