\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('market.optionomics_feature_observation_link') IS NULL THEN
    RAISE EXCEPTION 'Optionomics feature-to-observation lineage table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='market'
      AND event_object_table='optionomics_feature_observation_link'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'Optionomics context lineage is mutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='market.optionomics_feature_observation_link'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%observation_role%PRIMARY_CHAIN%CONTEXT%'
  ) THEN
    RAISE EXCEPTION 'Optionomics context lineage role constraint missing';
  END IF;
END $$;
ROLLBACK;
