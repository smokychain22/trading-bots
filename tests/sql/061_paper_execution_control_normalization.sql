DO $$
DECLARE
  pause_state boolean;
  master_state boolean;
  follower_state boolean;
  authorization_id uuid;
BEGIN
  SELECT pause_new_orders,master_execution_enabled,follower_execution_enabled,authorization_event_id
  INTO pause_state,master_state,follower_state,authorization_id
  FROM ops.paper_execution_control WHERE singleton=true;

  IF follower_state OR (NOT master_state AND NOT pause_state) THEN
    RAISE EXCEPTION 'Paper execution control is not fail-closed';
  END IF;

  IF master_state AND NOT EXISTS (
    SELECT 1 FROM ops.paper_execution_authorization_event
    WHERE authorization_event_id=authorization_id
      AND account_role='MASTER_THETA_PAPER'
      AND environment='PAPER'
      AND master_submission_authorized
      AND NOT follower_submission_authorized
      AND NOT live_money_authorized
  ) THEN
    RAISE EXCEPTION 'active master control lacks immutable Paper authorization';
  END IF;
END;
$$;
