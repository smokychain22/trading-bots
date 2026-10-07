BEGIN;

-- 2026-10-07 first real Paper CSP fill: the broker-fill lifecycle router applies an opening short put as event_kind 'SHORT_PUT_OPEN'
-- (broker-fill-lifecycle-router.ts / postgres-lifecycle-application-store.ts), but neither 017 nor 058 ever allowed that kind, so the
-- first fill failed with 23514 and the position could not be registered for management. Additive only: the allowed set is widened by
-- exactly the one kind the runtime already emits; no existing row, kind or semantics changes.
ALTER TABLE trade.lifecycle_application
  DROP CONSTRAINT IF EXISTS lifecycle_application_event_kind_check;
ALTER TABLE trade.lifecycle_application
  ADD CONSTRAINT lifecycle_application_event_kind_check CHECK (event_kind IN (
    'SHORT_PUT_OPEN',
    'SHORT_PUT_ASSIGNMENT','COVERED_CALL_ASSIGNMENT','OPTION_EXPIRATION',
    'OPTION_CLOSE','OPTION_PARTIAL_CLOSE','OPTION_ROLL','COVERED_CALL_OPEN','STOCK_DISPOSAL'
  ));

INSERT INTO core.schema_migration(version,checksum)
VALUES('070_lifecycle_short_put_open_event',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
