DO $$ BEGIN
  IF to_regclass('legacy_neon.import_batch') IS NULL OR
     to_regclass('legacy_neon.artifact_file') IS NULL OR
     to_regclass('legacy_neon.artifact_record') IS NULL THEN
    RAISE EXCEPTION 'legacy Neon staging tables missing';
  END IF;
  IF (SELECT count(DISTINCT event_object_table) FROM information_schema.triggers
      WHERE trigger_schema='legacy_neon' AND trigger_name='reject_immutable_mutation'
      AND event_object_table IN ('artifact_file','artifact_record'))<>2 THEN
    RAISE EXCEPTION 'legacy Neon immutable evidence protection missing';
  END IF;
  IF EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='legacy_neon' AND table_name IN ('artifact_file','artifact_record')
      AND constraint_type='FOREIGN KEY' HAVING count(*)<>2
  ) THEN
    RAISE EXCEPTION 'legacy Neon batch lineage constraints missing';
  END IF;
END $$;
