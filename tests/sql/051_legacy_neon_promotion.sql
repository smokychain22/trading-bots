DO $$ BEGIN
  IF to_regclass('legacy_neon.promotion_batch') IS NULL OR
     to_regclass('legacy_neon.promotion_record') IS NULL OR
     to_regclass('research.legacy_neon_recovered_evidence') IS NULL OR
     to_regclass('ops.legacy_neon_recovered_engineering_history') IS NULL THEN
    RAISE EXCEPTION 'legacy Neon promotion relations missing';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='legacy_neon' AND event_object_table='promotion_record'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'promoted legacy evidence is not immutable';
  END IF;
  IF EXISTS(
    SELECT 1 FROM legacy_neon.promotion_batch WHERE execution_authorized
    UNION ALL
    SELECT 1 FROM legacy_neon.promotion_record WHERE execution_authorized
  ) THEN
    RAISE EXCEPTION 'legacy promotion authorized execution';
  END IF;
END $$;
