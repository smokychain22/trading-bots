DO $$
BEGIN
  IF to_regclass('research.optionomics_temporal_feature_observation') IS NULL THEN
    RAISE EXCEPTION 'research.optionomics_temporal_feature_observation is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='research'
      AND event_object_table='optionomics_temporal_feature_observation'
      AND trigger_name='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'Optionomics temporal evidence is not immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.optionomics_temporal_feature_observation'::regclass
      AND conname='optionomics_temporal_known_shape'
  ) THEN
    RAISE EXCEPTION 'Optionomics temporal known/unknown shape constraint is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='research.optionomics_temporal_feature_observation'::regclass
      AND conname='optionomics_temporal_time_order'
  ) THEN
    RAISE EXCEPTION 'Optionomics temporal time-order constraint is missing';
  END IF;
END $$;
