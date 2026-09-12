\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('copy.follower_chain_participation') IS NULL OR
     to_regclass('copy.follower_chain_participation_event') IS NULL THEN
    RAISE EXCEPTION 'follower participation ledger missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
    AND table_name='follower_copy_event' AND constraint_name='follower_copy_event_copy_locked') THEN
    RAISE EXCEPTION 'copy execution lock missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
    AND event_object_table='follower_copy_event' AND trigger_name='guard_disabled_follower_plan') THEN
    RAISE EXCEPTION 'copy chain/tenant guard missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='copy'
    AND table_name='follower_chain_participation_event'
    AND constraint_name='follower_chain_participation_event_workspace_fk') THEN
    RAISE EXCEPTION 'participation event tenant foreign key missing';
  END IF;
END $$;
ROLLBACK;
