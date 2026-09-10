DO $$
DECLARE
  pause_state boolean;
  master_state boolean;
  follower_state boolean;
BEGIN
  SELECT pause_new_orders, master_execution_enabled, follower_execution_enabled
    INTO pause_state, master_state, follower_state
  FROM ops.paper_execution_control WHERE singleton;
  IF pause_state IS DISTINCT FROM true OR master_state IS DISTINCT FROM false OR follower_state IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'paper execution controls did not fail closed';
  END IF;

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
