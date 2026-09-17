BEGIN;

ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_quote_lineage;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_quote_lineage CHECK (
  (quote_source IS NULL AND quote_feed IS NULL AND quote_semantics IS NULL AND quote_content_hash IS NULL)
  OR
  (quote_source IS NOT NULL AND length(btrim(quote_source)) > 0
    AND quote_semantics IN ('CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING','PAPER_INDICATIVE_REFERENCE')
    AND quote_content_hash ~ '^[0-9a-f]{64}$'
    AND (
      (instrument_type='OPTION' AND (
        quote_semantics <> 'PAPER_INDICATIVE_REFERENCE'
        OR (quote_source='ALPACA' AND quote_feed='INDICATIVE')
      ))
      OR (instrument_type='STOCK' AND quote_source='ALPACA' AND quote_feed IN ('SIP','IEX'))
    ))
);

ALTER TABLE trade.execution_price_event DROP CONSTRAINT IF EXISTS execution_price_event_source_semantics_check;
ALTER TABLE trade.execution_price_event ADD CONSTRAINT execution_price_event_source_semantics_check
  CHECK(source_semantics IN ('CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING','PAPER_INDICATIVE_REFERENCE','INDICATIVE','SESSION_RECORDED_RESEARCH','UNKNOWN'));

INSERT INTO core.schema_migration(version,checksum)
VALUES('055_paper_indicative_quote_reference',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
