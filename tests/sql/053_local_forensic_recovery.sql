DO $$
BEGIN
  IF to_regclass('legacy_neon.local_forensic_sweep') IS NULL OR
     to_regclass('legacy_neon.local_forensic_import_chunk') IS NULL OR
     to_regclass('legacy_neon.local_forensic_source') IS NULL OR
     to_regclass('legacy_neon.research_export_variant') IS NULL OR
     to_regclass('legacy_neon.missing_record_forensic_search') IS NULL OR
     to_regclass('ops.local_forensic_recovery_latest') IS NULL THEN
    RAISE EXCEPTION 'local forensic recovery relations missing';
  END IF;
  IF EXISTS(
    SELECT 1 FROM legacy_neon.local_forensic_sweep WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.local_forensic_import_chunk WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.local_forensic_source WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.research_export_variant WHERE execution_authorized
    UNION ALL SELECT 1 FROM legacy_neon.missing_record_forensic_search WHERE execution_authorized
  ) THEN RAISE EXCEPTION 'local forensic recovery authorized execution'; END IF;
  IF (SELECT count(DISTINCT event_object_table) FROM information_schema.triggers
      WHERE trigger_schema='legacy_neon' AND trigger_name='reject_immutable_mutation'
      AND event_object_table IN('local_forensic_sweep','local_forensic_import_chunk','local_forensic_source',
        'research_export_variant','missing_record_forensic_search')) <> 5 THEN
    RAISE EXCEPTION 'local forensic recovery immutability missing';
  END IF;
END $$;
