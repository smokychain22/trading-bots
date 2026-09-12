\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('research.theta_shadow_scan_run') IS NULL
    OR to_regclass('research.theta_shadow_scan_member') IS NULL
    OR to_regclass('research.theta_execution_observation_job') IS NULL THEN
    RAISE EXCEPTION 'real shadow evidence activation tables missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='research'
    AND event_object_table='theta_shadow_scan_run' AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'shadow scan evidence is not immutable';
  END IF;
END $$;
ROLLBACK;
