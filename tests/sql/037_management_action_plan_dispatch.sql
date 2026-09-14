\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='master_paper_action_plan' AND column_name='authority_kind'
  ) THEN RAISE EXCEPTION 'action-plan authority kind missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='master_paper_action_plan' AND column_name='depends_on_action_plan_id'
  ) THEN RAISE EXCEPTION 'action-plan dependency missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='trade' AND table_name='master_paper_action_plan' AND column_name='execution_order_intent_id'
  ) THEN RAISE EXCEPTION 'action-plan execution intent linkage missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='master_paper_action_plan_authority_shape_check'
  ) THEN RAISE EXCEPTION 'action-plan authority constraint missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='master_paper_action_plan_dependency_shape_check'
  ) THEN RAISE EXCEPTION 'roll dependency constraint missing'; END IF;
END $$;

ROLLBACK;
