BEGIN;

ALTER TABLE trade.order_intent
  ADD COLUMN IF NOT EXISTS quote_source text,
  ADD COLUMN IF NOT EXISTS quote_feed text,
  ADD COLUMN IF NOT EXISTS quote_content_hash char(64);

ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_quote_lineage;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_quote_lineage CHECK (
  (quote_source IS NULL AND quote_feed IS NULL AND quote_content_hash IS NULL)
  OR
  (quote_source = 'ALPACA'
    AND quote_feed IN ('OPRA','SIP','IEX')
    AND ((instrument_type = 'OPTION' AND quote_feed = 'OPRA')
      OR (instrument_type = 'STOCK' AND quote_feed IN ('SIP','IEX')))
    AND quote_content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS ix_order_intent_execution_lineage
  ON trade.order_intent(execution_account_id, decision_id, chain_id, created_at);

INSERT INTO core.schema_migration(version, checksum)
VALUES ('024_paper_execution_lineage', repeat('0', 64))
ON CONFLICT (version) DO NOTHING;

COMMIT;
