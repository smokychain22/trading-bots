\set ON_ERROR_STOP on
BEGIN;

INSERT INTO iam.workspace(workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000201', 'THETA_COPY_TEST');

INSERT INTO core.provider_connection(
  provider_connection_id, workspace_id, provider_code, environment, secret_ref, status
) VALUES (
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000201',
  'ALPACA', 'PAPER', 'test://master-secret-reference-only', 'CONNECTED'
);

INSERT INTO core.trading_account(
  account_id, workspace_id, provider_connection_id, provider_account_id, environment, status
) VALUES (
  '00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202',
  'synthetic-master-paper-account', 'PAPER', 'ACTIVE'
);

INSERT INTO core.bot_instance(bot_instance_id, workspace_id, account_id, mode)
VALUES (
  '00000000-0000-0000-0000-000000000204',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000203',
  'PAPER'
);

INSERT INTO copy.follower_account(
  follower_account_id, workspace_id, provider_account_ref, oauth_secret_ref,
  participation, account_ready, options_approved
) VALUES (
  '00000000-0000-0000-0000-000000000205',
  '00000000-0000-0000-0000-000000000201',
  'synthetic-follower-paper-account',
  'vault://synthetic-reference-only',
  'COPY_NEW_AND_MANAGE', true, true
);

INSERT INTO copy.follower_policy(
  follower_policy_id, follower_account_id, policy_version, allocation_usd,
  max_bot_capital_pct, max_ticker_exposure_pct, max_contracts,
  max_daily_loss_usd, max_open_positions, max_slippage_per_contract_usd
) VALUES (
  '00000000-0000-0000-0000-000000000206',
  '00000000-0000-0000-0000-000000000205',
  'copy-policy-test-v1', 10000, 25, 10, 1, 500, 3, 10
);

INSERT INTO copy.master_copy_event(
  master_copy_event_id, master_bot_instance_id, action, symbol,
  master_quantity, master_filled_quantity, occurred_at, payload_hash
) VALUES (
  'master-copy-event-1',
  '00000000-0000-0000-0000-000000000204',
  'OPEN_CSP', 'SYN', 5, 5, '2026-09-10T14:00:00Z', repeat('a', 64)
);

INSERT INTO copy.follower_copy_event(
  follower_copy_event_id, master_copy_event_id, follower_account_id,
  follower_policy_id, outcome, sync_state, intended_quantity,
  close_quantity, open_quantity, reason
) VALUES (
  'copy-event-follower-1', 'master-copy-event-1',
  '00000000-0000-0000-0000-000000000205',
  '00000000-0000-0000-0000-000000000206',
  'SKIP_ACCOUNT', 'BLOCKED', 0, 0, 0,
  'INSUFFICIENT_AUTHORIZED_CAPITAL'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO copy.follower_copy_event(
      follower_copy_event_id, master_copy_event_id, follower_account_id,
      follower_policy_id, outcome, sync_state, intended_quantity,
      close_quantity, open_quantity, reason
    ) VALUES (
      'copy-event-replay', 'master-copy-event-1',
      '00000000-0000-0000-0000-000000000205',
      '00000000-0000-0000-0000-000000000206',
      'COPY_FULL', 'PENDING_SYNC', 1, 0, 1, 'REPLAY'
    );
    RAISE EXCEPTION 'duplicate master event was accepted for one follower';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE copy.follower_copy_event
    SET intended_quantity = 1
    WHERE follower_copy_event_id = 'copy-event-follower-1';
    RAISE EXCEPTION 'immutable copy event was updated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    INSERT INTO copy.follower_policy(
      follower_account_id, policy_version, allocation_usd,
      max_bot_capital_pct, max_ticker_exposure_pct, max_contracts,
      max_daily_loss_usd, max_open_positions, max_slippage_per_contract_usd,
      join_existing_positions
    ) VALUES (
      '00000000-0000-0000-0000-000000000205',
      'copy-policy-invalid-join', 10000, 25, 10, 1, 500, 3, 10, true
    );
    RAISE EXCEPTION 'join-existing policy was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO copy.follower_order_intent(
      follower_order_intent_id, follower_copy_event_id, client_order_id,
      quantity, attempt
    ) VALUES (
      'intent-negative', 'copy-event-follower-1', 'client-negative', -1, 1
    );
    RAISE EXCEPTION 'negative follower quantity was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO copy.follower_order_intent(
  follower_order_intent_id, follower_copy_event_id, client_order_id,
  state, quantity, attempt
) VALUES (
  'intent-zero', 'copy-event-follower-1', 'theta-follower-stable-zero',
  'PLANNED', 0, 1
);

INSERT INTO copy.follower_reconciliation_event(
  follower_account_id, follower_copy_event_id, follower_order_intent_id,
  state, broker_quantity, expected_quantity, detail_json
) VALUES (
  '00000000-0000-0000-0000-000000000205',
  'copy-event-follower-1', 'intent-zero', 'RECONCILING', 0, 0,
  '{"reason":"synthetic zero-quantity reconciliation fixture"}'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM copy.follower_order_intent
    WHERE follower_order_intent_id = 'intent-zero'
      AND quantity = 0
      AND state = 'PLANNED'
  ) THEN
    RAISE EXCEPTION 'quantity zero plan was not preserved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'copy'
      AND column_name ~* '(access_token|refresh_token|client_secret)'
  ) THEN
    RAISE EXCEPTION 'plaintext OAuth credential column exists in copy schema';
  END IF;
END;
$$;

ROLLBACK;
