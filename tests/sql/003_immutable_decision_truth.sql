\set ON_ERROR_STOP on
BEGIN;

INSERT INTO iam.workspace(workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'THETA_TEST');

INSERT INTO core.provider_connection(
  provider_connection_id, workspace_id, provider_code, environment, secret_ref, status
) VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'ALPACA', 'PAPER', 'test://secret-reference-only', 'CONNECTED'
);

INSERT INTO core.trading_account(
  account_id, workspace_id, provider_connection_id, provider_account_id, environment, status
) VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'synthetic-paper-account', 'PAPER', 'ACTIVE'
);

INSERT INTO core.strategy_version(strategy_version_id, semantic_version, config_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000004', 'test-strategy-v1', '{}', repeat('1', 64), 'ACTIVE');
INSERT INTO core.risk_limit_version(risk_limit_version_id, semantic_version, limits_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000005', 'test-risk-v1', '{}', repeat('2', 64), 'ACTIVE');
INSERT INTO core.execution_version(execution_version_id, semantic_version, policy_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000006', 'test-execution-v1', '{}', repeat('3', 64), 'ACTIVE');
INSERT INTO core.cost_model_version(cost_model_version_id, semantic_version, assumptions_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000007', 'test-cost-v1', '{}', repeat('4', 64), 'ACTIVE');
INSERT INTO core.feature_version(feature_version_id, semantic_version, definition_manifest_json, config_hash)
VALUES ('00000000-0000-0000-0000-000000000008', 'test-feature-v1', '{}', repeat('5', 64));

INSERT INTO core.bot_instance(
  bot_instance_id, workspace_id, account_id, mode, strategy_version_id,
  risk_limit_version_id, execution_version_id, cost_model_version_id, feature_version_id
) VALUES (
  '00000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'PAPER',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007',
  '00000000-0000-0000-0000-000000000008'
);

INSERT INTO trade.account_snapshot(account_id, equity, cash, buying_power, as_of, retrieved_at, payload_hash)
VALUES (
  '00000000-0000-0000-0000-000000000003', 100000, 100000, 100000,
  '2026-09-09T18:30:00Z', '2026-09-09T18:30:01Z', repeat('6', 64)
) RETURNING account_snapshot_id \gset

INSERT INTO trade.fusion_snapshot(
  fusion_snapshot_id, bot_instance_id, decision_time, trigger_type,
  strategy_version_id, feature_version_id, risk_limit_version_id,
  execution_version_id, cost_model_version_id, account_snapshot_id,
  portfolio_state_json, provider_provenance_json, unknown_features_json,
  snapshot_json, content_hash
) VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000009',
  '2026-09-09T18:30:02Z', 'PERIODIC_SCAN',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000008',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007',
  :'account_snapshot_id', '{}', '[{"provider":"ALPACA"}]',
  '[{"feature":"ivRank","reasonCode":"UNKNOWN"}]', '{}', repeat('a', 64)
);

INSERT INTO trade.candidate_set(
  candidate_set_id, fusion_snapshot_id, branch, candidate_count, generated_at, generator_version, set_hash
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000010',
  'THETA_CONVENTIONAL', 0, '2026-09-09T18:30:03Z', 'theta-q-runtime-v1', repeat('b', 64)
);

INSERT INTO trade.decision(
  decision_id, fusion_snapshot_id, candidate_set_id, decision_kind, action_code,
  quantity, aegis_action, strategy_branch, decided_at, status
) VALUES (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011',
  'ENTRY', 'WAIT', 0, 'HOLD_ONLY', 'THETA_CONVENTIONAL',
  '2026-09-09T18:30:04Z', 'FINAL'
);

DO $$
BEGIN
  BEGIN
    UPDATE trade.fusion_snapshot
    SET snapshot_json = '{"tampered":true}'::jsonb
    WHERE fusion_snapshot_id = '00000000-0000-0000-0000-000000000010';
    RAISE EXCEPTION 'immutable FusionSnapshot accepted an update';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    INSERT INTO trade.decision(
      fusion_snapshot_id, candidate_set_id, decision_kind, action_code,
      quantity, aegis_action, decided_at, status
    ) VALUES (
      '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000011',
      'ENTRY', 'WAIT', 1, 'HOLD_ONLY', now(), 'FINAL'
    );
    RAISE EXCEPTION 'WAIT accepted a non-zero quantity';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
