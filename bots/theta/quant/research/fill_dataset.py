"""PIT fill dataset (work package 50).

`dataset_contracts.ExecutionEvidence` mirrors `market.execution_quote_observation`
exactly -- it is quote evidence (arrival BBO, size, proposed limit, data
quality), never an order/fill record. There is no `filled`, `fillPrice`,
`cancelReplaced`, or `latency` field anywhere in the current Production
export schema. Per WP37's own finding, zero real BROKER_ACTUAL fill labels
exist in this repository today. This module therefore builds the
observable T0 half of the row honestly from what the schema actually
carries (arrival bid/ask/spread/size/contract/quote age/proposed limit as
intent) and marks every fill-outcome field explicitly `UNKNOWN`, naming the
fields that would resolve it once Codex's export schema (or a real broker
fill feed) actually carries them -- never inferring a fill/no-fill result
from quote evidence alone.
"""
from __future__ import annotations

from datetime import datetime
from research.production_export_loader import LoadedDatasetExport, canonical_json, sha256_hex

_FUTURE_IDENTIFIABLE_FIELDS = (
    'filled', 'fillPrice', 'fillTimestamp', 'latencySeconds', 'partialFillQuantity',
    'cancelReplaceCount', 'truthClass',
)


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('FILL_DATASET_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


def build_fill_dataset(export: LoadedDatasetExport, policy: dict):
    if policy.get('version') != 'theta-fill-dataset-policy-v1' or not policy.get('policyId'):
        raise ValueError('FILL_DATASET_POLICY_REQUIRED')
    if policy.get('evidenceClass') not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('FILL_DATASET_EVIDENCE_CLASS_REQUIRED')
    max_quote_age = policy.get('maxQuoteAgeSeconds')
    if not isinstance(max_quote_age, (int, float)) or max_quote_age <= 0:
        raise ValueError('FILL_DATASET_QUOTE_POLICY_REQUIRED')

    contracts_by_candidate = {c.candidate_id: c.contract for c in export.candidates}
    rows, excluded = [], []
    for quote in export.execution_evidence:
        reasons = []
        if quote.bid is None or quote.ask is None or quote.bid <= 0 or quote.ask < quote.bid:
            reasons.append('FILL_DATASET_ARRIVAL_BBO_INVALID')
        if quote.provider_timestamp is None:
            reasons.append('FILL_DATASET_PROVIDER_TIMESTAMP_MISSING')
        contract = contracts_by_candidate.get(quote.candidate_id)
        if contract is None:
            reasons.append('FILL_DATASET_CONTRACT_IDENTITY_UNRESOLVED')
        if reasons:
            excluded.append({'quoteObservationId': quote.quote_observation_id, 'reasons': sorted(set(reasons))})
            continue
        quote_age_seconds = (_time(quote.ingestion_timestamp) - _time(quote.provider_timestamp)).total_seconds()
        if quote_age_seconds < 0 or quote_age_seconds > max_quote_age:
            excluded.append({'quoteObservationId': quote.quote_observation_id,
                              'reasons': ['FILL_DATASET_QUOTE_AGE_OUT_OF_POLICY']})
            continue
        spread = quote.ask - quote.bid
        rows.append({
            'quoteObservationId': quote.quote_observation_id, 'candidateId': quote.candidate_id,
            'managementInputSnapshotId': quote.management_input_snapshot_id,
            'observationRole': quote.observation_role.value, 'contract': contract,
            'arrivalBid': quote.bid, 'arrivalAsk': quote.ask, 'arrivalBidSize': quote.bid_size,
            'arrivalAskSize': quote.ask_size, 'spread': spread,
            'relativeSpread': (2 * spread / (quote.ask + quote.bid)) if (quote.ask + quote.bid) else None,
            'intentProposedLimit': quote.proposed_limit, 'quoteAgeSeconds': quote_age_seconds,
            'dataQuality': quote.data_quality.value, 'observedAt': quote.observed_at,
            'filled': None, 'fillPrice': None, 'fillTimestamp': None, 'latencySeconds': None,
            'partialFillQuantity': None, 'cancelReplaceCount': None, 'truthClass': 'UNKNOWN',
            'futureIdentifiableFields': list(_FUTURE_IDENTIFIABLE_FIELDS),
        })
    rows.sort(key=lambda r: (_time(r['observedAt']), r['quoteObservationId']))
    payload = {
        'version': 'theta-fill-dataset-v1', 'datasetHash': export.dataset_hash, 'policy': policy,
        'policyHash': sha256_hex(canonical_json(policy)), 'evidenceClass': policy['evidenceClass'],
        'rows': rows, 'excluded': excluded, 'rowCount': len(rows), 'brokerActualFillCount': 0,
        'brokerAuthority': False,
        'state': 'ARRIVAL_EVIDENCE_ONLY_NO_FILL_OUTCOME_IN_SCHEMA' if rows else 'NO_ELIGIBLE_QUOTE_EVIDENCE',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
