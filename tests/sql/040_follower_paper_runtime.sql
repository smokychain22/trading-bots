DO $$ BEGIN
  IF to_regclass('copy.follower_paper_action_plan') IS NULL
    OR to_regclass('copy.follower_paper_action_plan_event') IS NULL
    OR to_regclass('copy.follower_lifecycle_divergence_event') IS NULL
    OR to_regclass('copy.follower_runtime_checkpoint') IS NULL THEN
    RAISE EXCEPTION 'follower Paper runtime tables are missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.triggers WHERE trigger_schema='copy'
    AND event_object_table='follower_paper_action_plan' AND trigger_name='reject_immutable_mutation') THEN
    RAISE EXCEPTION 'follower Paper action plans must be immutable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
    AND conname='follower_paper_action_plan_execution_authorized_check') THEN
    RAISE EXCEPTION 'follower execution authorization lock is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
    AND conname='follower_paper_action_plan_execution_gate_check') THEN
    RAISE EXCEPTION 'follower execution gate lock is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='copy.follower_paper_action_plan'::regclass
    AND conname='follower_paper_action_plan_order_shape') THEN
    RAISE EXCEPTION 'follower order action and position-intent shape constraint is missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='copy'
    AND table_name='follower_reconciliation_event' AND column_name='event_key') THEN
    RAISE EXCEPTION 'follower reconciliation idempotency key is missing';
  END IF;
END $$;
