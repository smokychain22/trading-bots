BEGIN;

CREATE TABLE market.alpaca_corporate_action_query (
  query_id uuid PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  symbols_json jsonb NOT NULL CHECK (jsonb_typeof(symbols_json)='array'),
  start_date date NOT NULL,
  end_date date NOT NULL,
  pages_read integer NOT NULL CHECK (pages_read > 0),
  pagination_complete boolean NOT NULL,
  negative_coverage_qualified boolean NOT NULL CHECK (negative_coverage_qualified=false),
  observation_count integer NOT NULL CHECK (observation_count >= 0),
  contract_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_alpaca_ca_query_time ON market.alpaca_corporate_action_query(observed_at DESC);
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.alpaca_corporate_action_query
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

CREATE TABLE market.alpaca_corporate_action_first_observation (
  observation_id uuid PRIMARY KEY,
  query_id uuid NOT NULL REFERENCES market.alpaca_corporate_action_query(query_id),
  family text NOT NULL,
  symbol text NOT NULL,
  provider_id_hash char(64) CHECK (provider_id_hash ~ '^[0-9a-f]{64}$'),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  process_date date,
  ex_date date,
  declaration_date date,
  provider_known_at timestamptz,
  first_observed_at timestamptz NOT NULL,
  pending_unsupported boolean NOT NULL,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family,symbol,payload_hash)
);
CREATE INDEX ix_alpaca_ca_symbol_date ON market.alpaca_corporate_action_first_observation(symbol,ex_date,process_date);
CREATE TRIGGER reject_immutable_mutation BEFORE UPDATE OR DELETE ON market.alpaca_corporate_action_first_observation
FOR EACH ROW EXECUTE FUNCTION core.reject_immutable_mutation();

INSERT INTO core.schema_migration(version,checksum)
VALUES('064_alpaca_corporate_action_observation',repeat('0',64));
COMMIT;
