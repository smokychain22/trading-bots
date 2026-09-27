"""PIT regime dataset -- observed inputs, deterministic baseline regime,
challenger regime, future labels kept separate (work package 49).

Codex's exported `candidate.volatility`/`.technical`/`.event` blobs are
opaque `Dict[str, Any]` per `dataset_contracts.py`'s own docstring -- this
module never guesses which export key corresponds to which
`models.regime_v0.RegimeInputs` field. The caller's policy must declare an
explicit `fieldMapping` (RegimeInputs field name -> dotted export path); an
export key absent from the mapping is never silently read, and an
unresolved input field feeds `regime_v0.classify()` as `None` (its own
documented not-UNKNOWN-fabrication contract), never a made-up default.

There is no promoted regime challenger yet (see `regime_v0.py`'s own
module docstring: "a future challenger... would only be promoted if it
beats this rule-based v0 on untouched-OOS economic value"), so
`challengerRegime` is always `NOT_IMPLEMENTED` here, not a silently-empty
dict standing in for "no challenger."
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from research.production_export_loader import LoadedDatasetExport, canonical_json, sha256_hex
from research.whole_chain_dataset import build_whole_chain_dataset
from models.regime_v0 import RegimeInputs, RegimePolicyV0, classify


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('REGIME_DATASET_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


def _resolve_path(candidate, dotted_path):
    node = candidate
    for part in dotted_path.split('.'):
        if isinstance(node, dict):
            node = node.get(part)
        else:
            node = getattr(node, part, None)
        if node is None:
            return None
    return node


_REGIME_INPUT_FIELDS = (
    'ma_slope', 'rv20', 'max_adverse_gap', 'earnings_distance_days',
    'corporate_action_pending', 'macro_risk_flag', 'spread_pct', 'portfolio_or_market_drawdown',
)


def build_regime_dataset(export: LoadedDatasetExport, policy: dict):
    if policy.get('version') != 'theta-regime-dataset-policy-v1' or not policy.get('policyId'):
        raise ValueError('REGIME_DATASET_POLICY_REQUIRED')
    if policy.get('evidenceClass') not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('REGIME_DATASET_EVIDENCE_CLASS_REQUIRED')
    mapping = policy.get('fieldMapping')
    if not isinstance(mapping, dict) or not mapping or any(k not in _REGIME_INPUT_FIELDS for k in mapping):
        raise ValueError('REGIME_DATASET_FIELD_MAPPING_REQUIRED')
    regime_policy_raw = policy.get('regimePolicy')
    if not isinstance(regime_policy_raw, dict):
        raise ValueError('REGIME_DATASET_BASELINE_POLICY_REQUIRED')
    regime_policy = RegimePolicyV0(**regime_policy_raw)

    # Chain-linked future outcome, reusing the existing chain-join authority
    # rather than re-deriving entry->chain resolution here.
    chains = build_whole_chain_dataset(export)
    future_by_candidate = {}
    for chain_row in chains['rows']:
        has_label = chain_row['outcomeState'] == 'RESOLVED_EXPORTED_LABEL'
        future = {
            'state': chain_row['outcomeState'],
            'wholeChainAfterCostPnl': chain_row['wholeChainAfterCostPnl'] if has_label else None,
            'labelAvailableAt': chain_row['labelAvailableAt'] if has_label else None,
        }
        for candidate_id in (chain_row['entryCandidateIds'] or ()):
            future_by_candidate[candidate_id] = future

    rows = []
    for candidate in export.candidates:
        resolved = {field: _resolve_path(candidate, mapping[field]) if field in mapping else None
                    for field in _REGIME_INPUT_FIELDS}
        inputs = RegimeInputs(**resolved)
        snapshot = classify(inputs, regime_policy)
        rows.append({
            'candidateId': candidate.candidate_id, 'observedAt': candidate.decision_time,
            'observedInputs': asdict(inputs),
            'baselineRegime': {**asdict(snapshot), 'trend_state': snapshot.trend_state.value if snapshot.trend_state else None,
                'volatility_state': snapshot.volatility_state.value if snapshot.volatility_state else None,
                'event_state': snapshot.event_state.value if snapshot.event_state else None,
                'liquidity_state': snapshot.liquidity_state.value if snapshot.liquidity_state else None,
                'stress_state': snapshot.stress_state.value if snapshot.stress_state else None,
                'reasons': [r for r in asdict(snapshot)['reasons'] if r is not None]},
            'baselineRegimeVersion': regime_policy.policy_version,
            'challengerRegime': None, 'challengerState': 'NOT_IMPLEMENTED',
            'futureOutcome': future_by_candidate.get(candidate.candidate_id, {
                'state': 'NO_CHAIN_LINKAGE', 'wholeChainAfterCostPnl': None, 'labelAvailableAt': None}),
        })
    rows.sort(key=lambda r: (_time(r['observedAt']), r['candidateId']))
    payload = {
        'version': 'theta-regime-dataset-v1', 'datasetHash': export.dataset_hash,
        'chainDatasetHash': chains['contentHash'], 'policy': policy,
        'policyHash': sha256_hex(canonical_json(policy)), 'evidenceClass': policy['evidenceClass'],
        'rows': rows, 'rowCount': len(rows), 'brokerAuthority': False,
        'state': 'ROWS_JOINED_NOT_MODEL_QUALIFIED' if rows else 'NO_CANDIDATES',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
