"""Selected CSP entry + persisted BBO + resolved chain -> bounded research rows.

The initial feature vocabulary deliberately contains only qualified contract/BBO
facts. It is not a claim that all Optionomics features are training-qualified.
Neither a candidate scan nor an unresolved position becomes a labeled episode.
"""
from __future__ import annotations

from datetime import datetime
from math import isfinite
from research.production_export_loader import canonical_json, sha256_hex
from research.whole_chain_dataset import build_whole_chain_dataset
from research.dataset_readiness import DependenceGroupKey, build_dependence_groups


FEATURE_UNITS = {'strike': 'USD_PER_SHARE', 'dte': 'CALENDAR_DAYS',
                 'bid': 'USD_PER_SHARE', 'ask': 'USD_PER_SHARE',
                 'relativeSpread': 'FRACTION_OF_MIDPOINT'}


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('ENTRY_TRAINING_TIMEZONE_REQUIRED')
    return result


def finite(value):
    return type(value) in (int, float) and isfinite(value)


def build_entry_episode_training_dataset(export, policy):
    if policy.get('version') != 'theta-entry-training-policy-v1' or not policy.get('policyId'):
        raise ValueError('ENTRY_TRAINING_POLICY_REQUIRED')
    names = policy.get('featureNames')
    if not isinstance(names, list) or not names or any(n not in FEATURE_UNITS for n in names) or len(set(names)) != len(names):
        raise ValueError('ENTRY_TRAINING_FEATURE_VOCABULARY_INVALID')
    maximum_age = policy.get('maxQuoteAgeSeconds')
    if not finite(maximum_age) or maximum_age <= 0:
        raise ValueError('ENTRY_TRAINING_QUOTE_POLICY_REQUIRED')
    frozen = timestamp(policy['frozenAt'])
    if policy.get('evidenceClass') not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('ENTRY_TRAINING_EVIDENCE_CLASS_REQUIRED')
    episodes = build_whole_chain_dataset(export)
    candidates = {r.candidate_id: r for r in export.candidates}
    quotes = {}
    for quote in export.execution_evidence:
        quotes.setdefault(quote.candidate_id, []).append(quote)
    labels = {r.outcome_label_id: r for r in export.whole_chain_outcomes}
    rows, excluded = [], []
    for episode in episodes['rows']:
        reasons = []
        identity = episode['economicChainId']
        if episode['entryLinkageState'] != 'EXPLICIT_LEDGER_JOIN':
            reasons.append(episode['entryLinkageState'])
        if episode['outcomeState'] != 'RESOLVED_EXPORTED_LABEL':
            reasons.append(episode['outcomeState'])
        if reasons:
            excluded.append({'economicChainId': identity, 'reasons': reasons})
            continue
        candidate = candidates[episode['entryCandidateIds'][0]]
        label = labels[episode['selectedOutcomeLabelId']]
        decision = timestamp(candidate.decision_time)
        if frozen > decision:
            reasons.append('FEATURE_POLICY_NOT_PREREGISTERED')
        if candidate.branch.value != 'THETA_CONVENTIONAL' or candidate.selected is not True:
            reasons.append('SELECTED_CONVENTIONAL_ENTRY_REQUIRED')
        # V2 is the first resolver that records actual evidence availability and
        # requires complete closed legs and known fees. Older labels remain in
        # the episode archive but cannot silently enter this target.
        if label.label_version != 'theta-whole-chain-outcome-resolver-v2' \
                or label.provenance.get('source') != 'THETA_ECONOMIC_LEDGER' \
                or label.outcomes.get('resolution') != 'CLOSED_LEDGER_CHAIN':
            reasons.append('AFTER_COST_LABEL_SEMANTICS_UNQUALIFIED')
        closed_at = label.outcomes.get('closedAt')
        evidence_at = label.provenance.get('evidenceAvailableAt')
        if not isinstance(closed_at, str) or not isinstance(evidence_at, str):
            reasons.append('LABEL_TIMING_MISSING')
        elif not decision <= timestamp(closed_at) <= timestamp(evidence_at) <= timestamp(label.label_available_at):
            reasons.append('LABEL_TIMING_INVALID')
        if not finite(label.whole_chain_net_pnl):
            reasons.append('AFTER_COST_LABEL_NONFINITE')
        market = candidate.market
        bid, ask = market.get('bid'), market.get('ask')
        if not finite(bid) or not finite(ask) or bid <= 0 or ask < bid:
            reasons.append('ENTRY_BBO_INVALID')
        contract = candidate.contract
        if not finite(contract.get('strike')) or contract['strike'] <= 0 \
                or not finite(contract.get('dte')) or contract['dte'] < 0 \
                or contract.get('multiplier') != 100:
            reasons.append('STANDARD_CONTRACT_FEATURES_INVALID')
        matching = [q for q in quotes.get(candidate.candidate_id, [])
            if q.source == 'ALPACA' and q.observation_role.value == 'DECISION'
            and q.data_quality.value == 'GOOD' and q.provider_timestamp is not None
            and q.bid == bid and q.ask == ask
            and q.provider_timestamp == market.get('quoteTimestamp')
            and q.ingestion_timestamp == market.get('quoteReceivedAt')
            and timestamp(q.provider_timestamp) <= timestamp(q.ingestion_timestamp) <= decision
            and timestamp(q.observed_at) <= decision
            and (decision - timestamp(q.provider_timestamp)).total_seconds() <= maximum_age]
        if not matching:
            reasons.append('PERSISTED_PIT_ENTRY_BBO_REQUIRED')
        if reasons:
            excluded.append({'economicChainId': identity, 'reasons': sorted(set(reasons))})
            continue
        matching.sort(key=lambda q: q.quote_observation_id)
        quote = matching[0]
        values = {'strike': contract['strike'], 'dte': contract['dte'], 'bid': bid, 'ask': ask,
                  'relativeSpread': 2 * (ask - bid) / (ask + bid)}
        if any(not finite(values[n]) for n in names):
            excluded.append({'economicChainId': identity, 'reasons': ['FEATURE_ARITHMETIC_NONFINITE']})
            continue
        # Linkage and label may only be available later. They never move a
        # feature backward. Training availability includes both label and link.
        available = max([label.label_available_at, episode['entryJoinAvailableAt']], key=timestamp)
        rows.append({'observationId': identity, 'economicChainId': identity,
            'candidateId': candidate.candidate_id, 'decisionId': candidate.decision_id,
            'underlying': contract['underlying'], 'branch': candidate.branch.value,
            'decisionAt': candidate.decision_time, 'featureAvailableAt': quote.ingestion_timestamp,
            'labelAvailableAt': available, 'labelWindowEnd': closed_at,
            'features': [values[n] for n in names], 'wholeChainAfterCostPnl': label.whole_chain_net_pnl,
            'positiveWholeChainLabel': int(label.whole_chain_net_pnl > 0),
            'evidenceIds': [candidate.candidate_id, quote.quote_observation_id, label.outcome_label_id,
                            *[link['optionLegId'] for link in episode['entryLinks']]],
            'evidenceHashes': [candidate.content_hash, quote.content_hash, label.content_hash]})
    rows.sort(key=lambda r: (timestamp(r['decisionAt']), r['observationId']))
    keys = [DependenceGroupKey(r['economicChainId'], r['economicChainId'], r['underlying'],
            # Calendar date is only a conservative grouping key, not a trading
            # session maturity count or proof of independent sample size.
            timestamp(r['decisionAt']).date().isoformat(), None) for r in rows]
    groups = build_dependence_groups(keys)
    for group, members in groups.items():
        for index in members:
            rows[index]['dependencyGroupId'] = group
    payload = {'version': 'theta-entry-episode-training-dataset-v1', 'datasetHash': export.dataset_hash,
        'episodeDatasetHash': episodes['contentHash'], 'policy': policy,
        'policyHash': sha256_hex(canonical_json(policy)), 'evidenceClass': policy['evidenceClass'],
        'featureNames': names, 'featureUnits': [FEATURE_UNITS[n] for n in names],
        'rows': rows, 'excluded': excluded, 'rowCount': len(rows),
        'dependencyComponentCount': len(groups), 'effectiveIndependentN': None,
        'selectionScope': 'EXECUTED_SELECTED_CONVENTIONAL_CSP_ENTRIES_ONLY',
        'unselectedCandidateOutcomesInferred': False, 'brokerAuthority': False,
        'state': 'ROWS_JOINED_NOT_MODEL_QUALIFIED' if rows else 'NO_ELIGIBLE_RESOLVED_ENTRIES'}
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
