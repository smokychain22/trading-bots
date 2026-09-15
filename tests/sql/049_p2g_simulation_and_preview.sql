DO $$ BEGIN
  IF to_regclass('research.theta_synthetic_lifecycle_receipt') IS NULL OR
     to_regclass('research.theta_paper_order_preview_receipt') IS NULL OR
     to_regclass('research.optionomics_family_health_observation') IS NULL THEN
    RAISE EXCEPTION 'P2G tables missing';
  END IF;
  IF (SELECT count(DISTINCT event_object_table) FROM information_schema.triggers
      WHERE trigger_schema='research' AND trigger_name='reject_immutable_mutation'
      AND event_object_table IN ('theta_synthetic_lifecycle_receipt','theta_paper_order_preview_receipt','optionomics_family_health_observation'))<>3 THEN
    RAISE EXCEPTION 'P2G immutable protection missing';
  END IF;
END $$;
