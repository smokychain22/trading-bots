DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM core.schema_migration WHERE version='047_p2e_time_path_intelligence') THEN
    RAISE EXCEPTION 'migration 047 missing';
  END IF;
  IF to_regclass('research.theta_position_path_checkpoint') IS NULL OR
     to_regclass('research.theta_action_inaction_frontier') IS NULL OR
     to_regclass('research.theta_strategy_timing_snapshot') IS NULL OR
     to_regclass('ops.theta_operator_control_event') IS NULL THEN
    RAISE EXCEPTION 'P2E evidence or operator table missing';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema IN ('research','ops')
    AND table_name IN ('theta_position_path_checkpoint','theta_action_inaction_frontier','theta_strategy_timing_snapshot','theta_operator_control_event')
    AND column_name='execution_authorized' AND column_default IS DISTINCT FROM 'false') THEN
    RAISE EXCEPTION 'P2E execution authorization default is unsafe';
  END IF;
END $$;
