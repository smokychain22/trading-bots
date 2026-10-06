BEGIN;

-- A native multi-leg parent is an order in its own right. It has no single
-- representative option contract or position intent. Its exact qualified
-- contracts live in the normalized child table below.
ALTER TABLE trade.order_intent
  ADD COLUMN IF NOT EXISTS order_class text NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS package_identity text,
  ADD COLUMN IF NOT EXISTS credit_debit_direction text;

ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_order_class;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_order_class CHECK (
  (order_class='simple' AND package_identity IS NULL AND credit_debit_direction IS NULL)
  OR (order_class='mleg' AND instrument_type='OPTION' AND option_contract_id IS NULL
    AND position_intent IS NULL AND package_identity IS NOT NULL
    AND credit_debit_direction IN ('CREDIT','DEBIT'))
);

ALTER TABLE trade.order_intent DROP CONSTRAINT IF EXISTS ck_order_intent_position_intent;
ALTER TABLE trade.order_intent ADD CONSTRAINT ck_order_intent_position_intent CHECK (
  (instrument_type='OPTION' AND order_class='simple' AND option_contract_id IS NOT NULL
    AND position_intent IN ('BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE')
    AND (side=position_intent
      OR (side='buy' AND position_intent IN ('BUY_TO_OPEN','BUY_TO_CLOSE'))
      OR (side='sell' AND position_intent IN ('SELL_TO_OPEN','SELL_TO_CLOSE'))))
  OR (instrument_type='OPTION' AND order_class='mleg' AND option_contract_id IS NULL AND position_intent IS NULL)
  OR (instrument_type='STOCK' AND order_class='simple' AND position_intent IS NULL AND side IN ('buy','sell'))
);

CREATE TABLE IF NOT EXISTS trade.order_intent_leg (
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  leg_index integer NOT NULL CHECK(leg_index>0),
  option_contract_id uuid NOT NULL REFERENCES market.option_contract(option_contract_id),
  provider_contract_id text NOT NULL,
  occ_symbol text NOT NULL,
  option_type text NOT NULL CHECK(option_type IN ('PUT','CALL')),
  position_intent text NOT NULL CHECK(position_intent IN ('buy_to_open','buy_to_close','sell_to_open','sell_to_close')),
  ratio_quantity integer NOT NULL CHECK(ratio_quantity>0),
  expiration date NOT NULL,
  strike numeric(20,8) NOT NULL CHECK(strike>0),
  multiplier integer NOT NULL CHECK(multiplier>0),
  deliverable_identity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_intent_id,leg_index),
  UNIQUE(order_intent_id,occ_symbol)
);

CREATE TABLE IF NOT EXISTS trade.broker_order_leg_state (
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  leg_index integer NOT NULL,
  provider_parent_order_id text NOT NULL,
  provider_leg_order_id text,
  occ_symbol text NOT NULL,
  requested_quantity integer NOT NULL CHECK(requested_quantity>0),
  filled_quantity integer NOT NULL CHECK(filled_quantity>=0 AND filled_quantity<=requested_quantity),
  remaining_quantity integer NOT NULL CHECK(remaining_quantity>=0 AND remaining_quantity<=requested_quantity),
  average_fill_price numeric(20,8),
  broker_status text NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY(order_intent_id,leg_index),
  FOREIGN KEY(order_intent_id,leg_index) REFERENCES trade.order_intent_leg(order_intent_id,leg_index)
);

CREATE INDEX IF NOT EXISTS ix_broker_order_leg_state_parent
  ON trade.broker_order_leg_state(provider_parent_order_id);

CREATE TABLE IF NOT EXISTS trade.multi_leg_lifecycle_event (
  lifecycle_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  provider_event_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('EXPIRATION','ASSIGNMENT','EXERCISE','PIN_REVIEW','UNEXPECTED_ONE_LEG_STATE')),
  leg_index integer,
  shares_delta integer,
  cash_flow numeric(24,8),
  occurred_at timestamptz NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A parent-level event (expiration, pin review) has no leg index; NULLs are distinct in a plain UNIQUE, which would let a replayed broker event insert twice.
-- Leg indexes are > 0, so 0 is an unambiguous sentinel for "parent level".
CREATE UNIQUE INDEX IF NOT EXISTS ux_multi_leg_lifecycle_event_identity
  ON trade.multi_leg_lifecycle_event(order_intent_id,provider_event_id,(COALESCE(leg_index,0)));

CREATE TABLE IF NOT EXISTS trade.multi_leg_chain_accounting (
  order_intent_id uuid PRIMARY KEY REFERENCES trade.order_intent(order_intent_id),
  chain_id uuid NOT NULL REFERENCES trade.economic_chain(chain_id),
  opening_net_credit numeric(24,8) NOT NULL,
  opening_fees numeric(24,8) NOT NULL,
  closing_net_debit numeric(24,8),
  closing_fees numeric(24,8) NOT NULL DEFAULT 0,
  assignment_exercise_cash_flow numeric(24,8) NOT NULL DEFAULT 0,
  realized_pnl numeric(24,8),
  remaining_exposure text NOT NULL CHECK(remaining_exposure IN ('NONE','OPEN_SPREAD','STOCK_INVENTORY','UNKNOWN')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((remaining_exposure='NONE')=(realized_pnl IS NOT NULL))
);

INSERT INTO core.schema_migration(version,checksum)
VALUES('069_multi_leg_order_durability',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
