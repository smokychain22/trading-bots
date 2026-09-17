DO $$
BEGIN
  IF to_regclass('ops.paper_execution_authorization_event') IS NULL THEN
    RAISE EXCEPTION 'master Paper authorization event table missing';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='ops' AND event_object_table='paper_execution_authorization_event'
      AND trigger_name='reject_immutable_mutation'
  ) THEN RAISE EXCEPTION 'master Paper authorization events are mutable'; END IF;
  IF EXISTS(SELECT 1 FROM ops.paper_execution_control WHERE singleton AND follower_execution_enabled) THEN
    RAISE EXCEPTION 'follower execution enabled';
  END IF;
  IF EXISTS(SELECT 1 FROM ops.paper_execution_control
    WHERE singleton AND master_execution_enabled AND authorization_event_id IS NULL) THEN
    RAISE EXCEPTION 'master execution lacks authorization lineage';
  END IF;
  IF EXISTS(SELECT 1 FROM ops.paper_execution_authorization_event
    WHERE follower_submission_authorized OR live_money_authorized OR environment<>'PAPER') THEN
    RAISE EXCEPTION 'authorization escaped Paper-only boundary';
  END IF;
END $$;
