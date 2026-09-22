DO $$
BEGIN
  IF to_regclass('market.optionomics_iv_session_observation') IS NULL
    OR to_regclass('risk.aegis_iv_stress_assessment') IS NULL THEN
    RAISE EXCEPTION 'AEGIS IV stress evidence tables are missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE NOT tgisinternal AND tgname='reject_immutable_mutation'
        AND tgrelid IN ('market.optionomics_iv_session_observation'::regclass,
          'risk.aegis_iv_stress_assessment'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'AEGIS IV stress evidence immutability triggers are missing';
  END IF;
END $$;
