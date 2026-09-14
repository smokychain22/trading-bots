BEGIN;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='trade' AND table_name='order_intent' AND column_name='execution_tier')
    THEN RAISE EXCEPTION 'order intent execution tier missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='order_intent_paper_evidence_quantity_reduces_only')
    THEN RAISE EXCEPTION 'Paper evidence reducing-only constraint missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='order_intent_submitted_quantity_matches_evidence')
    THEN RAISE EXCEPTION 'submitted Paper quantity equality constraint missing'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conname IN ('master_paper_action_plan_execution_tier_check','order_intent_execution_tier_check')
    AND pg_get_constraintdef(oid) LIKE '%LIVE_AUTHORIZED%') THEN RAISE EXCEPTION 'LIVE tier accepted by Paper tables'; END IF;
END $$;

ROLLBACK;
