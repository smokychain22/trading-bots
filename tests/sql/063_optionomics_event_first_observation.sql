DO $$
BEGIN
  IF to_regclass('market.optionomics_event_first_observation') IS NULL THEN
    RAISE EXCEPTION 'Optionomics event first-observation table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='market.optionomics_event_first_observation'::regclass
      AND tgname='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'Optionomics event immutability trigger missing';
  END IF;
  IF to_regclass('research.optionomics_capability_qualification_receipt') IS NULL THEN
    RAISE EXCEPTION 'Optionomics capability receipt table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid='research.optionomics_capability_qualification_receipt'::regclass
      AND tgname='reject_immutable_mutation'
  ) THEN
    RAISE EXCEPTION 'Optionomics capability receipt immutability trigger missing';
  END IF;
END $$;
