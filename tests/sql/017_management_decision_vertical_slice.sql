\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('trade.management_input_snapshot') IS NULL
    OR to_regclass('trade.management_action_frontier') IS NULL
    OR to_regclass('trade.lifecycle_application') IS NULL THEN
    RAISE EXCEPTION 'management decision vertical-slice tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='broker_position_snapshot' AND column_name='current_price'
  ) THEN RAISE EXCEPTION 'broker position management marks are missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='trade' AND t.relname='lifecycle_application' AND c.contype='u'
  ) THEN RAISE EXCEPTION 'lifecycle evidence idempotency constraint missing'; END IF;
END $$;

ROLLBACK;
