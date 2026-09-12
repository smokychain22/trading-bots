\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('trade.candidate_set_evidence') IS NULL
    OR to_regclass('trade.candidate_point_in_time_evidence') IS NULL
    OR to_regclass('trade.global_wait_evidence') IS NULL
    OR to_regclass('market.execution_quote_observation') IS NULL
    OR to_regclass('research.theta_outcome_label') IS NULL
    OR to_regclass('research.theta_counterfactual_outcome') IS NULL
    OR to_regclass('research.theta_dataset_export') IS NULL
    OR to_regclass('ops.decision_trigger_evidence') IS NULL
    OR to_regclass('trade.decision_invalidation_snapshot') IS NULL THEN
    RAISE EXCEPTION 'point-in-time evidence pipeline tables missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='trade'
    AND event_object_table='candidate_point_in_time_evidence' AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'candidate evidence is not immutable';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='fill'
    AND column_name='fees' AND (is_nullable<>'YES' OR column_default IS NOT NULL)) THEN
    RAISE EXCEPTION 'missing fill fees are still coerced to zero';
  END IF;
END $$;
ROLLBACK;
