BEGIN;

-- A terminal close order can have real fills without closing the entire leg.
-- Keep each terminal partial realization append-only. The option_leg remains
-- open until its remaining quantity reaches a separately confirmed terminal
-- lifecycle event. This avoids mutating original quantity or fabricating a
-- fully closed position.
CREATE TABLE IF NOT EXISTS trade.option_partial_close_realization (
  partial_close_realization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_leg_id uuid NOT NULL REFERENCES trade.option_leg(option_leg_id),
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  terminal_order_status text NOT NULL CHECK (terminal_order_status IN ('CANCELED','REJECTED','EXPIRED')),
  closed_quantity numeric(20,8) NOT NULL CHECK (closed_quantity > 0),
  remaining_quantity_after numeric(20,8) NOT NULL CHECK (remaining_quantity_after > 0),
  weighted_close_price_per_share numeric(20,8) NOT NULL CHECK (weighted_close_price_per_share >= 0),
  allocated_opening_credit numeric(24,8) NOT NULL,
  closing_debit numeric(24,8) NOT NULL CHECK (closing_debit >= 0),
  explicit_fees numeric(24,8),
  realized_pnl_before_fees numeric(24,8) NOT NULL,
  realized_pnl_after_fees numeric(24,8),
  fill_evidence_hash char(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_intent_id),
  UNIQUE (fill_evidence_hash),
  CHECK (realized_pnl_before_fees = allocated_opening_credit - closing_debit),
  CHECK (realized_pnl_after_fees IS NULL OR explicit_fees IS NOT NULL),
  CHECK (realized_pnl_after_fees IS NULL OR realized_pnl_after_fees = realized_pnl_before_fees - explicit_fees)
);

CREATE INDEX IF NOT EXISTS ix_option_partial_close_leg
  ON trade.option_partial_close_realization(option_leg_id, occurred_at);

ALTER TABLE trade.lifecycle_application
  DROP CONSTRAINT IF EXISTS lifecycle_application_event_kind_check;
ALTER TABLE trade.lifecycle_application
  ADD CONSTRAINT lifecycle_application_event_kind_check CHECK (event_kind IN (
    'SHORT_PUT_ASSIGNMENT','COVERED_CALL_ASSIGNMENT','OPTION_EXPIRATION',
    'OPTION_CLOSE','OPTION_PARTIAL_CLOSE','OPTION_ROLL','COVERED_CALL_OPEN','STOCK_DISPOSAL'
  ));

DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.option_partial_close_realization;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.option_partial_close_realization
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('058_terminal_partial_close_accounting',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
