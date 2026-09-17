DO $$ BEGIN
  IF to_regclass('legacy_neon.reconstruction_sweep') IS NULL OR
     to_regclass('legacy_neon.reconstruction_source') IS NULL OR
     to_regclass('legacy_neon.family_recovery_assessment') IS NULL OR
     to_regclass('ops.legacy_reconstruction_latest') IS NULL THEN
    RAISE EXCEPTION 'legacy reconstruction registry relations missing';
  END IF;
  IF EXISTS(
    SELECT 1 FROM legacy_neon.reconstruction_sweep WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.reconstruction_source WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.family_recovery_assessment WHERE execution_authorized
  ) THEN
    RAISE EXCEPTION 'legacy reconstruction registry authorized execution';
  END IF;
END $$;
