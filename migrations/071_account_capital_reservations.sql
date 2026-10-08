BEGIN;

-- Shared account-wide commitments, not a second sizing or broker authority.
-- Account identity is the broker-account hash, so two execution identities
-- cannot independently spend the same account envelope.
CREATE TABLE trade.capital_envelope (
  envelope_id uuid PRIMARY KEY,
  provider_account_ref_hash char(64) NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > observed_at),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  envelope_json jsonb NOT NULL CHECK (jsonb_typeof(envelope_json)='object' AND octet_length(envelope_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_account_ref_hash, observed_at)
);
CREATE TABLE trade.capital_reservation (
  reservation_id uuid PRIMARY KEY,
  provider_account_ref_hash char(64) NOT NULL,
  execution_account_id uuid NOT NULL REFERENCES trade.execution_account(execution_account_id),
  envelope_id uuid NOT NULL REFERENCES trade.capital_envelope(envelope_id),
  proposal_ref text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  proposal_json jsonb NOT NULL CHECK (jsonb_typeof(proposal_json)='object' AND octet_length(proposal_json::text)<=65536),
  remaining_quantity integer NOT NULL CHECK (remaining_quantity >= 0),
  order_intent_id uuid UNIQUE REFERENCES trade.order_intent(order_intent_id),
  state text NOT NULL CHECK (state IN ('RESERVED','SUBMISSION_POSSIBLE','RECONCILED')),
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_account_ref_hash, proposal_ref)
);
CREATE INDEX ix_capital_reservation_active ON trade.capital_reservation(provider_account_ref_hash)
  WHERE remaining_quantity > 0;
CREATE UNIQUE INDEX ux_capital_reservation_decision ON trade.capital_reservation
  (provider_account_ref_hash, (proposal_json->>'decisionId'));
CREATE TABLE trade.capital_reservation_event (
  event_id uuid PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES trade.capital_reservation(reservation_id),
  observed_at timestamptz NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  evidence_json jsonb NOT NULL CHECK (jsonb_typeof(evidence_json)='object' AND octet_length(evidence_json::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.capital_envelope
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.capital_reservation_event
  FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE FUNCTION trade.guard_capital_reservation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
    OR NEW.provider_account_ref_hash IS DISTINCT FROM OLD.provider_account_ref_hash
    OR NEW.execution_account_id IS DISTINCT FROM OLD.execution_account_id
    OR NEW.envelope_id IS DISTINCT FROM OLD.envelope_id
    OR NEW.proposal_ref IS DISTINCT FROM OLD.proposal_ref
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.proposal_json IS DISTINCT FROM OLD.proposal_json
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.remaining_quantity > OLD.remaining_quantity
    OR (OLD.order_intent_id IS NOT NULL AND NEW.order_intent_id IS DISTINCT FROM OLD.order_intent_id)
  THEN RAISE EXCEPTION 'CAPITAL_RESERVATION_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_capital_reservation_identity BEFORE UPDATE ON trade.capital_reservation
  FOR EACH ROW EXECUTE FUNCTION trade.guard_capital_reservation_identity();

INSERT INTO core.schema_migration(version,checksum)
VALUES('071_account_capital_reservations',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
