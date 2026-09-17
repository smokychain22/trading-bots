DO $$
DECLARE
  pause_state boolean;
  master_state boolean;
  follower_state boolean;
  authorization_id uuid;
BEGIN
  SELECT pause_new_orders, master_execution_enabled, follower_execution_enabled, authorization_event_id
    INTO pause_state, master_state, follower_state, authorization_id
  FROM ops.paper_execution_control WHERE singleton;
  IF pause_state IS DISTINCT FROM true OR follower_state IS DISTINCT FROM false OR
     (master_state IS DISTINCT FROM false AND (master_state IS DISTINCT FROM true OR authorization_id IS NULL)) THEN
    RAISE EXCEPTION 'paper execution controls did not fail closed';
  END IF;
  IF master_state AND NOT EXISTS(
    SELECT 1 FROM ops.paper_execution_authorization_event
    WHERE authorization_event_id=authorization_id AND account_role='MASTER_THETA_PAPER'
      AND environment='PAPER' AND master_submission_authorized
      AND NOT follower_submission_authorized AND NOT live_money_authorized
  ) THEN RAISE EXCEPTION 'master Paper authority is missing or unsafe'; END IF;

  BEGIN
    INSERT INTO trade.execution_account(account_kind, environment, provider_account_ref_hash, provider_account_ref_masked)
    VALUES ('MASTER_API_KEY', 'LIVE', repeat('a', 64), '••••0000');
    RAISE EXCEPTION 'LIVE execution account was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'trade' AND indexname = 'ix_order_intent_restart_recovery'
  ) THEN
    RAISE EXCEPTION 'restart recovery index is missing';
  END IF;
END;
$$;
