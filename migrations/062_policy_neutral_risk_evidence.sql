BEGIN;

-- A reusable, policy-neutral history surface over evidence already persisted
-- by the canonical decision funnel. This view adds no thresholds, fills, or
-- provider claims. It preserves UNKNOWN as NULL and avoids a second raw-data
-- collector for IV and spread history.
CREATE OR REPLACE VIEW research.option_contract_risk_history AS
SELECT
  candidate.candidate_id,
  candidate.decision_id,
  candidate.decision_time,
  candidate.branch,
  candidate.selected,
  candidate.hard_status,
  candidate.soft_status,
  candidate.contract_json->>'underlying' AS underlying,
  candidate.contract_json->>'contractSymbol' AS contract_symbol,
  candidate.contract_json->>'optionType' AS option_type,
  CASE WHEN jsonb_typeof(candidate.contract_json->'strike')='number'
    THEN (candidate.contract_json->>'strike')::numeric END AS strike,
  CASE WHEN jsonb_typeof(candidate.contract_json->'dte')='number'
    THEN (candidate.contract_json->>'dte')::integer END AS dte,
  CASE WHEN jsonb_typeof(candidate.contract_json->'moneyness')='number'
    THEN (candidate.contract_json->>'moneyness')::numeric END AS moneyness,
  CASE WHEN jsonb_typeof(candidate.volatility_json->'iv')='number'
    THEN (candidate.volatility_json->>'iv')::numeric END AS implied_volatility,
  quote.bid,
  quote.ask,
  CASE WHEN quote.bid IS NOT NULL AND quote.ask IS NOT NULL AND quote.ask >= quote.bid
    THEN (quote.bid + quote.ask) / 2 END AS mid,
  CASE WHEN quote.bid IS NOT NULL AND quote.ask IS NOT NULL AND quote.ask >= quote.bid
      AND (quote.bid + quote.ask) > 0
    THEN (quote.ask - quote.bid) / ((quote.bid + quote.ask) / 2) END AS relative_spread,
  quote.bid_size,
  quote.ask_size,
  quote.provider_timestamp,
  quote.ingestion_timestamp,
  quote.source,
  quote.operation_alias,
  quote.feed,
  quote.contract_version AS quote_contract_version,
  quote.data_quality,
  candidate.feature_version,
  candidate.strategy_version,
  candidate.provider_provenance_json,
  candidate.content_hash AS candidate_content_hash,
  quote.content_hash AS quote_content_hash
FROM trade.candidate_point_in_time_evidence candidate
LEFT JOIN LATERAL (
  SELECT observation.*
  FROM market.execution_quote_observation observation
  WHERE observation.candidate_id=candidate.candidate_id
    AND observation.observation_role='DECISION'
  ORDER BY observation.observed_at DESC,observation.quote_observation_id DESC
  LIMIT 1
) quote ON true;

INSERT INTO core.schema_migration(version,checksum)
VALUES('062_policy_neutral_risk_evidence',repeat('0',64)) ON CONFLICT DO NOTHING;

COMMIT;
