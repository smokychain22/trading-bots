"""Offline outcome-analysis consumer for the canonical R8B/R8C registry.

Does not invent treatment decisions, outcomes, independent samples or promotion.
Consumes paired, release-bound policy outcome evidence from replay/resolvers.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime
import json
from math import isfinite
from pathlib import Path
import subprocess

from research.ablation import paired_mean_difference
from research.experiment_registry import EXPERIMENTS, R8B_ENTRY_COMPARISONS, R8C_MANAGEMENT_COMPARISONS
from research.validation_experiment import digest


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('EXPERIMENT_TIMEZONE_REQUIRED')
    return result


def execute_controlled_experiments(raw, eligible_experiment_ids=None):
    if raw['version'] != 'theta-controlled-experiment-input-v1':
        raise ValueError('EXPERIMENT_CONTRACT_VERSION_INVALID')
    if raw['evidenceClass'] not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('EXPERIMENT_EVIDENCE_CLASS_REQUIRED')
    if digest(raw['pairs']) != raw['pairManifestHash']:
        raise ValueError('EXPERIMENT_PAIR_MANIFEST_MISMATCH')
    evaluated_at = instant(raw['evaluatedAt'])
    policy = raw['policy']
    frozen_at = instant(policy['frozenAt'])
    minimum = policy['minimumIndependentClusters']
    if not policy['version'] or type(minimum) is not int or minimum < 2 or not policy['dependencyDefinition']:
        raise ValueError('EXPERIMENT_GOVERNANCE_REQUIRED')
    ids = [item[0] for item in R8B_ENTRY_COMPARISONS + R8C_MANAGEMENT_COMPARISONS]
    definitions = {item.experiment_id: item for item in EXPERIMENTS if item.experiment_id in ids}
    grouped = {identity: [] for identity in ids}
    seen = set()
    for row in raw['pairs']:
        experiment_id = row['experimentId']
        if experiment_id not in grouped:
            raise ValueError('UNREGISTERED_EXPERIMENT')
        identity = (experiment_id, row['episodeId'])
        if identity in seen:
            raise ValueError('DUPLICATE_EXPERIMENT_EPISODE')
        seen.add(identity)
        if not row['episodeId'] or not row['dependencyClusterId'] or not row['sourceEvidenceIds']:
            raise ValueError('EXPERIMENT_LINEAGE_REQUIRED')
        decision = instant(row['decisionAt'])
        if frozen_at >= decision or decision > evaluated_at:
            raise ValueError('EXPERIMENT_POLICY_NOT_PREREGISTERED')
        if instant(row['featureAvailableAt']) > decision:
            raise ValueError('EXPERIMENT_FUTURE_FEATURE')
        arms = [row['control'], row['treatment']]
        for arm in arms:
            if not arm['policyVersion'] or not arm['decisionReceiptHash'] or not arm['costModelVersion']:
                raise ValueError('EXPERIMENT_ARM_LINEAGE_REQUIRED')
            if arm['outcomeState'] not in ('RESOLVED', 'RIGHT_CENSORED', 'NOT_IDENTIFIABLE'):
                raise ValueError('EXPERIMENT_OUTCOME_STATE_INVALID')
            if arm['executionClass'] not in ('BROKER_CONFIRMED', 'MODELED_EXECUTION'):
                raise ValueError('EXPERIMENT_FILL_SEMANTICS_REQUIRED')
            if arm['units'] != 'USD_WHOLE_CHAIN_AFTER_COST':
                raise ValueError('EXPERIMENT_ECONOMIC_UNIT_MISMATCH')
            if instant(arm['horizonStart']) != decision or instant(arm['horizonEnd']) <= decision:
                raise ValueError('EXPERIMENT_HORIZON_INVALID')
            if arm['outcomeState'] == 'RESOLVED':
                if type(arm['netPnl']) not in (int, float) or not isfinite(arm['netPnl']):
                    raise ValueError('EXPERIMENT_RESOLVED_PNL_INVALID')
                if arm['labelAvailableAt'] is None or not (instant(arm['horizonEnd']) <= instant(arm['labelAvailableAt']) <= evaluated_at):
                    raise ValueError('EXPERIMENT_LABEL_NOT_AVAILABLE')
            elif arm['netPnl'] is not None:
                raise ValueError('EXPERIMENT_CENSORED_PNL_MUST_REMAIN_UNKNOWN')
        if arms[0]['horizonDefinitionVersion'] != arms[1]['horizonDefinitionVersion'] \
                or instant(arms[0]['horizonEnd']) != instant(arms[1]['horizonEnd']) \
                or arms[0]['capitalBasis'] != arms[1]['capitalBasis'] \
                or arms[0]['executionClass'] != arms[1]['executionClass'] \
                or arms[0]['costModelVersion'] != arms[1]['costModelVersion']:
            raise ValueError('EXPERIMENT_ARMS_NOT_COMMON_BASIS')
        if not arms[0]['capitalBasis'] or not arms[0]['horizonDefinitionVersion']:
            raise ValueError('EXPERIMENT_COMMON_BASIS_REQUIRED')
        grouped[experiment_id].append(row)
    results = []
    for identity in ids:
        rows = sorted(grouped[identity], key=lambda r: r['episodeId'])
        if eligible_experiment_ids is not None and identity not in eligible_experiment_ids:
            results.append({'experimentId': identity, 'state': 'NOT_RUN_READINESS',
                'reason': 'CANONICAL_DATASET_READINESS_GATE', 'pairedEpisodes': len(rows),
                'clusterMeanIncrementalPnl': None, 'pairedClusterStandardError': None,
                'promotionState': 'RESEARCH_ONLY'})
            continue
        complete = [r for r in rows if all(r[arm]['outcomeState'] == 'RESOLVED' for arm in ('control', 'treatment'))]
        # Keep whole dependency groups out when any member is censored. A partial
        # cluster must not become a shorter, selected-survivor independent sample.
        censored_clusters = {r['dependencyClusterId'] for r in rows if r not in complete}
        clusters = {}
        for row in complete:
            if row['dependencyClusterId'] not in censored_clusters:
                clusters.setdefault(row['dependencyClusterId'], []).append(row)
        ordered_clusters = [clusters[key] for key in sorted(clusters)]
        control = [sum(r['control']['netPnl'] for r in cluster) / len(cluster) for cluster in ordered_clusters]
        treatment = [sum(r['treatment']['netPnl'] for r in cluster) / len(cluster) for cluster in ordered_clusters]
        enough = len(clusters) >= minimum
        delta, error = paired_mean_difference(control, treatment) if enough else (None, None)
        definition = definitions[identity]
        results.append({'experimentId': identity, 'protocol': asdict(definition.protocol),
            'state': 'NOT_RUN_NO_DATA' if not rows else 'INSUFFICIENT_N' if not enough else 'RUN_COMPLETE_NOT_PROMOTABLE',
            'pairedEpisodes': len(rows), 'resolvedPairs': len(complete), 'unresolvedPairs': len(rows) - len(complete),
            'completeDependencyClusters': len(clusters), 'censoredDependencyClusters': len(censored_clusters),
            'minimumIndependentClusters': minimum, 'effectiveN': None,
            'effectiveNState': 'CLUSTER_INDEPENDENCE_NOT_EMPIRICALLY_VALIDATED',
            'clusterMeanIncrementalPnl': delta, 'pairedClusterStandardError': error,
            'weighting': 'EQUAL_DEPENDENCY_CLUSTER_MEANS',
            'sourceEvidenceIds': sorted({i for r in rows for i in r['sourceEvidenceIds']}),
            'promotionState': 'RESEARCH_ONLY',
            'unprovenPromotionRequirements': ['OOS_STABILITY', 'TAIL_AND_DRAWDOWN_ACCEPTANCE', 'PAPER_STABILITY', 'OWNER_AUTHORITY']})
    payload = {'version': 'theta-controlled-experiment-receipt-v1', 'canonicalSourceSha': raw['canonicalSourceSha'],
        'datasetHash': raw['datasetHash'], 'pairManifestHash': raw['pairManifestHash'],
        'policy': policy, 'evaluatedAt': raw['evaluatedAt'], 'evidenceClass': raw['evidenceClass'],
        'results': results, 'brokerAuthority': False, 'modelPromoted': False,
        'profitability': 'EMPIRICALLY_UNPROVEN'}
    return {**payload, 'contentHash': digest(payload)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = json.loads(Path(args.input).read_text(encoding='utf-8'))
    sha = raw['canonicalSourceSha']
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('EXPERIMENT_CANONICAL_SHA_INVALID')
    subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    receipt = execute_controlled_experiments(raw)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        json.dump(receipt, handle, sort_keys=True, indent=2, allow_nan=False)
    print(json.dumps({'contentHash': receipt['contentHash'], 'experiments': len(receipt['results']), 'brokerAuthority': False}))


if __name__ == '__main__':
    main()
