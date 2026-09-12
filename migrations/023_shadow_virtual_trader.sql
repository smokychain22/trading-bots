BEGIN;

CREATE TABLE IF NOT EXISTS research.theta_shadow_virtual_account (
  shadow_account_id uuid PRIMARY KEY,
  bot_instance_id uuid NOT NULL UNIQUE REFERENCES core.bot_instance(bot_instance_id),
  seed_account_snapshot_id bigint NOT NULL REFERENCES trade.account_snapshot(account_snapshot_id),
  initial_equity numeric(24,8) NOT NULL CHECK(initial_equity > 0),
  initial_cash numeric(24,8) NOT NULL CHECK(initial_cash >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
  policy_version text NOT NULL,
  evidence_class text NOT NULL DEFAULT 'LIVE_SHADOW' CHECK(evidence_class='LIVE_SHADOW'),
  execution_authorized boolean NOT NULL DEFAULT false CHECK(execution_authorized=false),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS research.theta_shadow_order_intent (
  shadow_intent_id uuid PRIMARY KEY,
  shadow_account_id uuid NOT NULL REFERENCES research.theta_shadow_virtual_account(shadow_account_id),
  scan_id uuid NOT NULL REFERENCES research.theta_shadow_scan_run(scan_id),
  candidate_id uuid NOT NULL REFERENCES trade.candidate(candidate_id),
  decision_id uuid REFERENCES trade.decision(decision_id),
  fusion_snapshot_id uuid NOT NULL REFERENCES trade.fusion_snapshot(fusion_snapshot_id),
  option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id),
  strategy_branch text NOT NULL,
  position_intent text NOT NULL CHECK(position_intent IN ('SELL_TO_OPEN','BUY_TO_CLOSE','SELL_TO_CLOSE','BUY_TO_OPEN')),
  quantity integer NOT NULL CHECK(quantity > 0),
  multiplier numeric(20,8) NOT NULL CHECK(multiplier > 0),
  limit_price numeric(20,8) NOT NULL CHECK(limit_price > 0),
  decision_bid numeric(20,8) NOT NULL CHECK(decision_bid >= 0),
  decision_ask numeric(20,8) NOT NULL CHECK(decision_ask >= decision_bid),
  decision_bid_size numeric(20,8),
  decision_ask_size numeric(20,8),
  quote_observation_id uuid NOT NULL REFERENCES market.execution_quote_observation(quote_observation_id),
  decision_time timestamptz NOT NULL,
  quote_timestamp timestamptz,
  selection_policy_version text NOT NULL,
  execution_policy_version text NOT NULL,
  cost_model_version text NOT NULL,
  empirical_ev_ready boolean NOT NULL DEFAULT false CHECK(empirical_ev_ready=false),
  broker_submission_allowed boolean NOT NULL DEFAULT false CHECK(broker_submission_allowed=false),
  reason_codes_json jsonb NOT NULL CHECK(jsonb_typeof(reason_codes_json)='array'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE(scan_id, position_intent)
);
CREATE INDEX IF NOT EXISTS ix_shadow_intent_candidate ON research.theta_shadow_order_intent(candidate_id,decision_time);

CREATE TABLE IF NOT EXISTS research.theta_shadow_order_event (
  shadow_order_event_id uuid PRIMARY KEY,
  shadow_intent_id uuid NOT NULL REFERENCES research.theta_shadow_order_intent(shadow_intent_id),
  state text NOT NULL CHECK(state IN ('PENDING_SHADOW','FILLED_SHADOW','PARTIAL_SHADOW','UNFILLED_SHADOW','EXPIRED_UNFILLED','INVALIDATED_BEFORE_FILL','UNKNOWN_EXECUTABILITY')),
  occurred_at timestamptz NOT NULL,
  quote_observation_id uuid REFERENCES market.execution_quote_observation(quote_observation_id),
  filled_quantity integer CHECK(filled_quantity IS NULL OR filled_quantity > 0),
  remaining_quantity integer CHECK(remaining_quantity IS NULL OR remaining_quantity >= 0),
  reason_code text NOT NULL,
  policy_version text NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  CHECK((state IN ('FILLED_SHADOW','PARTIAL_SHADOW')) = (filled_quantity IS NOT NULL)),
  CHECK(state <> 'FILLED_SHADOW' OR remaining_quantity=0),
  CHECK(state <> 'PARTIAL_SHADOW' OR remaining_quantity>0)
);
CREATE INDEX IF NOT EXISTS ix_shadow_order_event_latest ON research.theta_shadow_order_event(shadow_intent_id,occurred_at DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS research.theta_shadow_fill (
  shadow_fill_id uuid PRIMARY KEY,
  shadow_intent_id uuid NOT NULL REFERENCES research.theta_shadow_order_intent(shadow_intent_id),
  quote_observation_id uuid NOT NULL REFERENCES market.execution_quote_observation(quote_observation_id),
  quantity integer NOT NULL CHECK(quantity > 0),
  price numeric(20,8) NOT NULL CHECK(price > 0),
  multiplier numeric(20,8) NOT NULL CHECK(multiplier > 0),
  gross_cashflow numeric(24,8) NOT NULL,
  modeled_cost numeric(24,8),
  filled_at timestamptz NOT NULL,
  fill_policy_version text NOT NULL,
  evidence_class text NOT NULL CHECK(evidence_class='LIVE_SHADOW'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE(shadow_intent_id,quote_observation_id)
);

CREATE TABLE IF NOT EXISTS research.theta_shadow_chain (
  shadow_chain_id uuid PRIMARY KEY,
  shadow_account_id uuid NOT NULL REFERENCES research.theta_shadow_virtual_account(shadow_account_id),
  underlying_id uuid NOT NULL REFERENCES market.underlying(underlying_id),
  opening_intent_id uuid NOT NULL UNIQUE REFERENCES research.theta_shadow_order_intent(shadow_intent_id),
  opened_at timestamptz NOT NULL,
  strategy_version text NOT NULL,
  risk_version text NOT NULL,
  feature_version text NOT NULL,
  cost_model_version text NOT NULL,
  execution_model_version text NOT NULL,
  evidence_class text NOT NULL CHECK(evidence_class='LIVE_SHADOW'),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS research.theta_shadow_lifecycle_event (
  shadow_lifecycle_event_id uuid PRIMARY KEY,
  shadow_chain_id uuid NOT NULL REFERENCES research.theta_shadow_chain(shadow_chain_id),
  event_type text NOT NULL CHECK(event_type IN ('CSP_OPENED','CSP_PARTIAL','CSP_MARKED','CSP_CLOSED','CSP_EXPIRED','CSP_ASSIGNED','ROLL_CLOSE','ROLL_OPEN','STOCK_HELD','RECOVERY_WAIT','STOCK_CLOSED','CC_OPENED','CC_CLOSED','CC_EXPIRED','CALLED_AWAY','CHAIN_CLOSED')),
  from_state text,
  to_state text NOT NULL CHECK(to_state IN ('CSP_OPEN','CSP_PARTIAL','CSP_CLOSED','CSP_EXPIRED','ASSIGNED','STOCK_HELD','RECOVERY_WAIT','CC_OPEN','CALLED_AWAY','CLOSED')),
  occurred_at timestamptz NOT NULL,
  shadow_fill_id uuid REFERENCES research.theta_shadow_fill(shadow_fill_id),
  quantity integer,
  cashflow numeric(24,8),
  realized_pnl numeric(24,8),
  unrealized_pnl numeric(24,8),
  secured_collateral numeric(24,8),
  capital_days numeric(24,8),
  reason_code text NOT NULL,
  evidence_json jsonb NOT NULL CHECK(jsonb_typeof(evidence_json)='object'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shadow_lifecycle_chain ON research.theta_shadow_lifecycle_event(shadow_chain_id,occurred_at,created_at);

CREATE TABLE IF NOT EXISTS research.theta_shadow_account_snapshot (
  shadow_account_snapshot_id uuid PRIMARY KEY,
  shadow_account_id uuid NOT NULL REFERENCES research.theta_shadow_virtual_account(shadow_account_id),
  as_of timestamptz NOT NULL,
  cash numeric(24,8),
  equity numeric(24,8),
  reserved_collateral numeric(24,8) NOT NULL CHECK(reserved_collateral >= 0),
  buying_power numeric(24,8),
  realized_pnl numeric(24,8),
  unrealized_pnl numeric(24,8),
  open_option_contracts integer NOT NULL CHECK(open_option_contracts >= 0),
  stock_shares integer NOT NULL CHECK(stock_shares >= 0),
  source_event_id uuid REFERENCES research.theta_shadow_lifecycle_event(shadow_lifecycle_event_id),
  policy_version text NOT NULL,
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shadow_account_snapshot_latest ON research.theta_shadow_account_snapshot(shadow_account_id,as_of DESC,created_at DESC);

DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['theta_shadow_virtual_account','theta_shadow_order_intent','theta_shadow_order_event','theta_shadow_fill','theta_shadow_chain','theta_shadow_lifecycle_event','theta_shadow_account_snapshot'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON research.%I', target);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON research.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()', target);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('023_shadow_virtual_trader',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
