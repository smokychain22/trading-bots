\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('market.optionomics_raw_observation') IS NULL
    OR to_regclass('market.optionomics_feature_snapshot') IS NULL
    OR to_regclass('research.optionomics_quote_qualification_run') IS NULL THEN
    RAISE EXCEPTION 'Optionomics layered evidence tables missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='market'
    AND event_object_table='optionomics_raw_observation' AND trigger_name='reject_immutable_mutation')
    OR NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='market'
    AND event_object_table='optionomics_feature_snapshot' AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'Optionomics evidence is mutable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema='research' AND constraint_name='optionomics_quote_ready_requires_documented_authority'
      AND check_clause LIKE '%ORDER_PRICING_DOCUMENTED%') THEN
    RAISE EXCEPTION 'Optionomics readiness semantic guard missing';
  END IF;
END $$;
ROLLBACK;
