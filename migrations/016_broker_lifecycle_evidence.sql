BEGIN;

-- Reconciliation snapshots previously stored only counts and unmatched fact
-- summaries. Lifecycle management needs exact point-in-time quantities, so
-- each broker read now gets a complete immutable position set. An empty set
-- is represented by zero rows tied to a reconciliation snapshot whose
-- position_count is zero, never by invented quantity-zero rows.
CREATE TABLE IF NOT EXISTS trade.broker_position_snapshot (
  reconciliation_snapshot_id uuid NOT NULL REFERENCES trade.broker_reconciliation_snapshot(reconciliation_snapshot_id),
  connection_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  symbol text NOT NULL,
  quantity numeric(24,8),
  side text,
  asset_class text,
  observed_at timestamptz NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(reconciliation_snapshot_id, symbol)
);
CREATE INDEX IF NOT EXISTS ix_broker_position_snapshot_latest
  ON trade.broker_position_snapshot(connection_id, observed_at DESC, symbol);

-- Provider activity IDs are hashed at the trust boundary. The activity fact
-- is immutable. Only last_observed_at may move forward when the same broker
-- fact appears in a later reconciliation pass.
CREATE TABLE IF NOT EXISTS trade.broker_activity_fact (
  broker_activity_fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES copy.follower_account(follower_account_id),
  provider_activity_ref_hash char(64) NOT NULL CHECK (provider_activity_ref_hash ~ '^[0-9a-f]{64}$'),
  activity_type text NOT NULL,
  symbol text,
  quantity numeric(24,8),
  price numeric(24,8),
  activity_at timestamptz,
  provider_order_ref_hash char(64) CHECK (provider_order_ref_hash IS NULL OR provider_order_ref_hash ~ '^[0-9a-f]{64}$'),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(connection_id, provider_activity_ref_hash),
  CHECK(last_observed_at >= first_observed_at)
);
CREATE INDEX IF NOT EXISTS ix_broker_activity_fact_lifecycle
  ON trade.broker_activity_fact(connection_id, symbol, activity_at, activity_type);

DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.broker_position_snapshot;
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.broker_position_snapshot
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION trade.protect_broker_activity_fact()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'broker activity facts are append-only' USING ERRCODE='55000';
  END IF;
  IF NEW.connection_id IS DISTINCT FROM OLD.connection_id
    OR NEW.provider_activity_ref_hash IS DISTINCT FROM OLD.provider_activity_ref_hash
    OR NEW.activity_type IS DISTINCT FROM OLD.activity_type
    OR NEW.symbol IS DISTINCT FROM OLD.symbol
    OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.price IS DISTINCT FROM OLD.price
    OR NEW.activity_at IS DISTINCT FROM OLD.activity_at
    OR NEW.provider_order_ref_hash IS DISTINCT FROM OLD.provider_order_ref_hash
    OR NEW.first_observed_at IS DISTINCT FROM OLD.first_observed_at
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    OR NEW.last_observed_at < OLD.last_observed_at THEN
    RAISE EXCEPTION 'broker activity fact payload is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_broker_activity_fact ON trade.broker_activity_fact;
CREATE TRIGGER protect_broker_activity_fact BEFORE UPDATE OR DELETE ON trade.broker_activity_fact
  FOR EACH ROW EXECUTE FUNCTION trade.protect_broker_activity_fact();

INSERT INTO core.schema_migration(version, checksum)
VALUES ('016_broker_lifecycle_evidence', repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
