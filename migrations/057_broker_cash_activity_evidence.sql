BEGIN;
-- Account-level broker cash facts. These columns deliberately do not assert a
-- chain allocation or use a default zero for absent broker amounts.
ALTER TABLE trade.broker_activity_fact ADD COLUMN IF NOT EXISTS net_amount numeric(24,8);
ALTER TABLE trade.broker_activity_fact ADD COLUMN IF NOT EXISTS per_share_amount numeric(24,8);
INSERT INTO core.schema_migration(version,checksum)
VALUES('057_broker_cash_activity_evidence',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
