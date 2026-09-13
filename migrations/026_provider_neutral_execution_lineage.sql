BEGIN;
ALTER TABLE trade.order_intent ADD COLUMN IF NOT EXISTS quote_semantics text;
ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_quote_lineage;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_quote_lineage CHECK (
  (quote_source IS NULL AND quote_feed IS NULL AND quote_semantics IS NULL AND quote_content_hash IS NULL)
  OR
  (quote_source IS NOT NULL AND length(btrim(quote_source)) > 0
    AND quote_semantics IN ('CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING')
    AND quote_content_hash ~ '^[0-9a-f]{64}$'
    AND ((instrument_type='OPTION')
      OR (instrument_type='STOCK' AND quote_source='ALPACA' AND quote_feed IN ('SIP','IEX'))))
);
INSERT INTO core.schema_migration(version,checksum)
VALUES('026_provider_neutral_execution_lineage',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
