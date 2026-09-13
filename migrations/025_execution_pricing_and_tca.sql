BEGIN;

CREATE TABLE IF NOT EXISTS trade.execution_price_event (
  execution_price_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_intent_id uuid NOT NULL REFERENCES trade.order_intent(order_intent_id),
  event_type text NOT NULL CHECK(event_type IN ('DECISION','ARRIVAL','INITIAL_LIMIT','REPLACEMENT','PARTIAL_FILL','FILL','CANCEL')),
  event_time timestamptz NOT NULL,
  provider text NOT NULL,
  source_semantics text NOT NULL CHECK(source_semantics IN ('CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING','INDICATIVE','SESSION_RECORDED_RESEARCH','UNKNOWN')),
  provider_timestamp timestamptz,
  received_at timestamptz NOT NULL,
  quote_age_ms bigint CHECK(quote_age_ms IS NULL OR quote_age_ms >= 0),
  bid numeric(24,8), ask numeric(24,8), bid_size numeric(24,8), ask_size numeric(24,8),
  mid numeric(24,8), spread numeric(24,8), microprice numeric(24,8),
  limit_price numeric(24,8), fill_price numeric(24,8),
  filled_quantity numeric(20,8) CHECK(filled_quantity IS NULL OR filled_quantity >= 0),
  policy_version text,
  attempt_no integer CHECK(attempt_no IS NULL OR attempt_no > 0),
  reason_code text NOT NULL,
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(provider_timestamp IS NULL OR provider_timestamp <= received_at),
  CHECK((bid IS NULL AND ask IS NULL) OR (bid > 0 AND ask > 0 AND bid <= ask)),
  CHECK(mid IS NULL OR (bid IS NOT NULL AND ask IS NOT NULL)),
  CHECK(spread IS NULL OR spread >= 0)
);
CREATE INDEX IF NOT EXISTS ix_execution_price_event_intent
  ON trade.execution_price_event(order_intent_id,event_time,attempt_no);

CREATE TABLE IF NOT EXISTS trade.transaction_cost_analysis (
  transaction_cost_analysis_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_intent_id uuid NOT NULL UNIQUE REFERENCES trade.order_intent(order_intent_id),
  contract_version text NOT NULL,
  calculated_at timestamptz NOT NULL,
  decision_mid numeric(24,8) NOT NULL,
  arrival_mid numeric(24,8) NOT NULL,
  fill_price numeric(24,8),
  spread_at_decision numeric(24,8) NOT NULL CHECK(spread_at_decision >= 0),
  spread_at_arrival numeric(24,8) NOT NULL CHECK(spread_at_arrival >= 0),
  spread_at_fill numeric(24,8) CHECK(spread_at_fill IS NULL OR spread_at_fill >= 0),
  limit_attempts integer NOT NULL CHECK(limit_attempts > 0),
  latency_ms bigint CHECK(latency_ms IS NULL OR latency_ms >= 0),
  slippage_dollars numeric(24,8),
  slippage_bps numeric(24,8),
  spread_capture numeric(24,12),
  fees numeric(24,8),
  estimated_market_impact numeric(24,8),
  post_fill_move_json jsonb NOT NULL CHECK(jsonb_typeof(post_fill_move_json)='object'),
  quote_provider text NOT NULL,
  quote_semantics text NOT NULL,
  provider_timestamp timestamptz,
  received_at timestamptz NOT NULL,
  quote_age_ms bigint CHECK(quote_age_ms IS NULL OR quote_age_ms >= 0),
  unknown_reasons_json jsonb NOT NULL CHECK(jsonb_typeof(unknown_reasons_json)='array'),
  content_hash char(64) NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(fees IS NOT NULL OR jsonb_array_length(unknown_reasons_json) > 0),
  CHECK(fill_price IS NOT NULL OR jsonb_array_length(unknown_reasons_json) > 0)
);

DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['execution_price_event','transaction_cost_analysis'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_immutable_mutation ON trade.%I', target);
    EXECUTE format('CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON trade.%I FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation()', target);
  END LOOP;
END $$;

INSERT INTO core.schema_migration(version,checksum)
VALUES('025_execution_pricing_and_tca',repeat('0',64)) ON CONFLICT DO NOTHING;
COMMIT;
