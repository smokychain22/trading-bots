\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('ops.runtime_worker_status') IS NULL
    OR to_regclass('ops.runtime_worker_lease') IS NULL
    OR to_regclass('ops.runtime_worker_event') IS NULL THEN
    RAISE EXCEPTION 'local worker runtime tables missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='ops' AND event_object_table='runtime_worker_event'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'local worker events are not immutable';
  END IF;
END $$;
ROLLBACK;
