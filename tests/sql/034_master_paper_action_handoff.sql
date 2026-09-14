BEGIN;

DO $$
BEGIN
  IF to_regclass('trade.master_paper_action_plan') IS NULL THEN RAISE EXCEPTION 'master action plan table missing'; END IF;
  IF to_regclass('trade.master_paper_action_plan_event') IS NULL THEN RAISE EXCEPTION 'master action plan event table missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='runtime_worker_status_execution_gate_check'
    AND pg_get_constraintdef(oid) LIKE '%ACTIVE%') THEN RAISE EXCEPTION 'active execution gate missing'; END IF;
END $$;

ROLLBACK;
