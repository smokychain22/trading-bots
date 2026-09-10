\set ON_ERROR_STOP on
BEGIN;

INSERT INTO iam.workspace(workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000101', 'THETA_LEDGER_TEST');

INSERT INTO core.provider_connection(
  provider_connection_id, workspace_id, provider_code, environment, secret_ref, status
) VALUES (
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  'ALPACA', 'PAPER', 'test://secret-reference-only', 'CONNECTED'
);

INSERT INTO core.trading_account(
  account_id, workspace_id, provider_connection_id, provider_account_id, environment, status
) VALUES (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'synthetic-ledger-account', 'PAPER', 'ACTIVE'
);

INSERT INTO core.strategy_version(strategy_version_id, semantic_version, config_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000104', 'ledger-test-strategy-v1', '{}', repeat('1', 64), 'ACTIVE');
INSERT INTO core.risk_limit_version(risk_limit_version_id, semantic_version, limits_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000105', 'ledger-test-risk-v1', '{}', repeat('2', 64), 'ACTIVE');
INSERT INTO core.execution_version(execution_version_id, semantic_version, policy_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000106', 'ledger-test-execution-v1', '{}', repeat('3', 64), 'ACTIVE');
INSERT INTO core.cost_model_version(cost_model_version_id, semantic_version, assumptions_json, config_hash, status)
VALUES ('00000000-0000-0000-0000-000000000107', 'ledger-test-cost-v1', '{}', repeat('4', 64), 'ACTIVE');
INSERT INTO core.feature_version(feature_version_id, semantic_version, definition_manifest_json, config_hash)
VALUES ('00000000-0000-0000-0000-000000000108', 'ledger-test-feature-v1', '{}', repeat('5', 64));

INSERT INTO core.bot_instance(
  bot_instance_id, workspace_id, account_id, mode, strategy_version_id,
  risk_limit_version_id, execution_version_id, cost_model_version_id, feature_version_id
) VALUES (
  '00000000-0000-0000-0000-000000000109',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103',
  'PAPER',
  '00000000-0000-0000-0000-000000000104',
  '00000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000106',
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000108'
);

INSERT INTO market.underlying(underlying_id, symbol, asset_type)
VALUES ('00000000-0000-0000-0000-000000000110', 'SYN', 'EQUITY');

INSERT INTO market.option_contract(
  option_contract_id, contract_symbol, underlying_id, option_type, strike, expiration_date, tradable, status
) VALUES (
  '00000000-0000-0000-0000-000000000111', 'SYN260116P00050000', '00000000-0000-0000-0000-000000000110',
  'PUT', 50.00, '2026-01-16', true, 'ACTIVE'
);
INSERT INTO market.option_contract(
  option_contract_id, contract_symbol, underlying_id, option_type, strike, expiration_date, tradable, status
) VALUES (
  '00000000-0000-0000-0000-000000000112', 'SYN260213P00045000', '00000000-0000-0000-0000-000000000110',
  'PUT', 45.00, '2026-02-13', true, 'ACTIVE'
);

INSERT INTO trade.economic_chain(chain_id, bot_instance_id, underlying_id, lifecycle_state, opened_at)
VALUES ('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000109',
        '00000000-0000-0000-0000-000000000110', 'CSP_OPEN', '2026-09-01T14:30:00Z');

-- The original CSP leg: opened, then closed at a realized LOSS via roll.
INSERT INTO trade.option_leg(
  option_leg_id, chain_id, option_contract_id, side, quantity, entry_price_per_share,
  entry_credit_debit, opened_at, closed_at, close_reason, close_price_per_share, realized_pnl
) VALUES (
  '00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000120',
  '00000000-0000-0000-0000-000000000111', 'SHORT', 1, 0.60, 60.00,
  '2026-09-01T14:30:00Z', '2026-09-10T14:30:00Z', 'ROLLED', 0.90, -30.00
);

-- The new leg the roll opened -- a SEPARATE row, its own economics.
INSERT INTO trade.option_leg(
  option_leg_id, chain_id, option_contract_id, side, quantity, entry_price_per_share,
  entry_credit_debit, opened_at, rolled_from_option_leg_id
) VALUES (
  '00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000120',
  '00000000-0000-0000-0000-000000000112', 'SHORT', 1, 0.80, 80.00,
  '2026-09-10T14:30:00Z', '00000000-0000-0000-0000-000000000121'
);

-- Linking the old leg forward to the new one is allowed (not a realized_pnl change).
UPDATE trade.option_leg
SET rolled_to_option_leg_id = '00000000-0000-0000-0000-000000000122'
WHERE option_leg_id = '00000000-0000-0000-0000-000000000121';

DO $$
DECLARE preserved_pnl numeric(24,8);
BEGIN
  SELECT realized_pnl INTO preserved_pnl FROM trade.option_leg
  WHERE option_leg_id = '00000000-0000-0000-0000-000000000121';
  IF preserved_pnl IS DISTINCT FROM -30.00 THEN
    RAISE EXCEPTION 'roll must not alter the old leg''s realized loss -- got %', preserved_pnl;
  END IF;
END;
$$;

-- Realized P&L is immutable once set: an attempt to change it must fail.
DO $$
BEGIN
  BEGIN
    UPDATE trade.option_leg SET realized_pnl = -1.00
    WHERE option_leg_id = '00000000-0000-0000-0000-000000000121';
    RAISE EXCEPTION 'realized_pnl mutation was accepted -- it must be immutable once set';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  BEGIN
    DELETE FROM trade.option_leg WHERE option_leg_id = '00000000-0000-0000-0000-000000000121';
    RAISE EXCEPTION 'deleting a leg with realized_pnl set was accepted -- it must be immutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END;
$$;

-- A closed leg without both close_reason and realized_pnl is rejected.
DO $$
BEGIN
  BEGIN
    INSERT INTO trade.option_leg(
      chain_id, option_contract_id, side, quantity, opened_at, closed_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000111',
      'SHORT', 1, now(), now()
    );
    RAISE EXCEPTION 'a closed leg with no realized_pnl/close_reason was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- Assignment creates stock inventory -- NOT an automatic realized win.
-- The stock_lot starts with disposed_at/realized_pnl both NULL; the
-- unrealized position remains visible until actually disposed of.
INSERT INTO trade.stock_lot(
  stock_lot_id, chain_id, underlying_id, shares, economic_basis_per_share,
  assignment_option_leg_id, acquired_at
) VALUES (
  '00000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-000000000120',
  '00000000-0000-0000-0000-000000000110', 100, 49.40,
  '00000000-0000-0000-0000-000000000122', '2026-09-10T14:30:00Z'
);

INSERT INTO trade.assignment_event(option_leg_id, stock_lot_id, assigned_at, shares, strike_price)
VALUES ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000123',
        '2026-09-10T14:30:00Z', 100, 45.00);

DO $$
DECLARE lot_realized_pnl numeric(24,8);
BEGIN
  SELECT realized_pnl INTO lot_realized_pnl FROM trade.stock_lot
  WHERE stock_lot_id = '00000000-0000-0000-0000-000000000123';
  IF lot_realized_pnl IS NOT NULL THEN
    RAISE EXCEPTION 'assignment must never automatically realize a stock P&L -- got %', lot_realized_pnl;
  END IF;
END;
$$;

-- Order intent / broker order / fill lineage, including an
-- UNKNOWN_SUBMISSION status (never resubmitted blindly -- reconciled).
INSERT INTO trade.order_intent(
  order_intent_id, chain_id, client_order_id, status, instrument_type,
  option_contract_id, side, quantity, limit_price
) VALUES (
  '00000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-000000000120',
  'theta-test-client-order-1', 'UNKNOWN_SUBMISSION', 'OPTION',
  '00000000-0000-0000-0000-000000000112', 'SELL_TO_OPEN', 1, 0.80
);

INSERT INTO trade.reconciliation_event(order_intent_id, chain_id, state, detail_json)
VALUES ('00000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-000000000120',
        'UNKNOWN_SUBMISSION', '{"reason": "network timeout awaiting broker acknowledgement"}');

INSERT INTO trade.broker_order(broker_order_id, order_intent_id, provider_order_id, submitted_at, acknowledged_at, broker_status)
VALUES ('00000000-0000-0000-0000-000000000125', '00000000-0000-0000-0000-000000000124',
        'alpaca-order-abc', '2026-09-10T14:29:00Z', '2026-09-10T14:29:01Z', 'accepted');

INSERT INTO trade.fill(broker_order_id, provider_fill_id, quantity, price_per_share, filled_at, fees)
VALUES ('00000000-0000-0000-0000-000000000125', 'alpaca-fill-1', 1, 0.80, '2026-09-10T14:30:00Z', 0.65);

-- Fills are append-only: an update or delete must be rejected.
DO $$
BEGIN
  BEGIN
    UPDATE trade.fill SET price_per_share = 0.99 WHERE provider_fill_id = 'alpaca-fill-1';
    RAISE EXCEPTION 'fill mutation was accepted -- fills must be append-only';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END;
$$;

-- Quantity must never be negative (never floored to 1 either -- zero is
-- separately valid and unconstrained by this CHECK).
DO $$
BEGIN
  BEGIN
    INSERT INTO trade.order_intent(client_order_id, status, instrument_type, side, quantity)
    VALUES ('theta-test-negative-qty', 'PROPOSED', 'OPTION', 'SELL_TO_OPEN', -1);
    RAISE EXCEPTION 'a negative order_intent quantity was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- Quantity zero is explicitly legitimate -- must succeed.
INSERT INTO trade.order_intent(client_order_id, status, instrument_type, side, quantity)
VALUES ('theta-test-zero-qty', 'PROPOSED', 'OPTION', 'SELL_TO_OPEN', 0);

ROLLBACK;
