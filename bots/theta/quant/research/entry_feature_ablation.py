"""Execute frozen feature removals on identical entry cohorts and PIT folds.

Reports paired Brier changes, not economic benefit, EV or promotion authority.
Repeated forward scores from one dependency component never inflate its count.
"""
from copy import deepcopy
from research.entry_baseline_experiment import execute_entry_baseline, hashed
from research.entry_episode_training import timestamp
from research.ablation import paired_mean_difference


def execute_entry_feature_ablation(dataset, baseline_policy, policy, generated_at):
    if policy.get('version') != 'theta-entry-feature-ablation-policy-v1' or not policy.get('policyId'):
        raise ValueError('ENTRY_ABLATION_POLICY_REQUIRED')
    frozen = timestamp(policy['frozenAt'])
    if any(frozen > timestamp(r['decisionAt']) for r in dataset['rows']):
        raise ValueError('ENTRY_ABLATION_NOT_PREREGISTERED')
    variants = policy['variants']
    if not variants or len({v['name'] for v in variants}) != len(variants):
        raise ValueError('ENTRY_ABLATION_VARIANT_IDENTITIES_INVALID')
    names = dataset['featureNames']
    for variant in variants:
        selected = variant['featureNames']
        if not variant['name'] or not selected or len(set(selected)) != len(selected) \
                or not set(selected) < set(names):
            raise ValueError('ENTRY_ABLATION_REQUIRES_STRICT_FEATURE_SUBSET')
    baseline = execute_entry_baseline(dataset, baseline_policy, generated_at)
    by_id = {r['observationId']: r for r in dataset['rows']}
    comparisons = []
    for variant in variants:
        projected = deepcopy(dataset)
        indexes = [names.index(n) for n in variant['featureNames']]
        projected['featureNames'] = variant['featureNames']
        projected['featureUnits'] = [dataset['featureUnits'][i] for i in indexes]
        for row in projected['rows']:
            row['features'] = [row['features'][i] for i in indexes]
        projected['projection'] = {'parentDatasetHash': dataset['contentHash'], 'policyHash': hashed(policy), 'variant': variant['name']}
        projected['contentHash'] = hashed({k: v for k, v in projected.items() if k != 'contentHash'})
        treatment = execute_entry_baseline(projected, baseline_policy, generated_at)
        if baseline['plan'] != treatment['plan']:
            raise ValueError('ENTRY_ABLATION_SPLIT_MISMATCH')
        grouped = {}
        unmatched = []
        for left, right in zip(baseline['folds'], treatment['folds']):
            if left['state'] != 'RESEARCH_FORWARD_EVALUATED' or right['state'] != 'RESEARCH_FORWARD_EVALUATED':
                unmatched.append({'fold': left['fold'], 'baselineState': left['state'], 'variantState': right['state']})
                continue
            left_scores = {r['observationId']: r['probability'] for r in left['forwardPredictions']}
            right_scores = {r['observationId']: r['probability'] for r in right['forwardPredictions']}
            if left_scores.keys() != right_scores.keys():
                raise ValueError('ENTRY_ABLATION_FORWARD_COHORT_MISMATCH')
            for identity in sorted(left_scores):
                row = by_id[identity]
                actual = row['positiveWholeChainLabel']
                grouped.setdefault(row['dependencyGroupId'], []).append(
                    ((left_scores[identity] - actual) ** 2, (right_scores[identity] - actual) ** 2))
        groups = [{'dependencyGroupId': key, 'pairedPredictionCount': len(values),
            'baselineBrier': sum(x for x, _ in values) / len(values),
            'variantBrier': sum(y for _, y in values) / len(values)} for key, values in sorted(grouped.items())]
        delta, error = paired_mean_difference([r['baselineBrier'] for r in groups], [r['variantBrier'] for r in groups])
        comparisons.append({'variant': variant['name'], 'featureNames': variant['featureNames'],
            'state': 'PAIRED_FORWARD_COMPARISON' if len(groups) >= 2 and not unmatched else 'INSUFFICIENT_OR_PARTIAL_PAIRED_EVIDENCE',
            'metric': 'VARIANT_MINUS_BASELINE_BRIER_LOWER_IS_BETTER_NOT_PROFIT',
            'meanPairedDelta': delta, 'componentMeanStandardError': error,
            'dependencyComponentCount': len(groups), 'effectiveIndependentN': None,
            'groups': groups, 'unmatchedFolds': unmatched, 'experiment': treatment})
    payload = {'version': 'theta-entry-feature-ablation-v1', 'datasetHash': dataset['contentHash'],
        'policy': policy, 'policyHash': hashed(policy), 'baseline': baseline, 'comparisons': comparisons,
        'generatedAt': generated_at, 'evidenceClass': dataset['evidenceClass'], 'finalOosTouched': False,
        'economicValueConclusion': 'NOT_ESTABLISHED_BY_PREDICTIVE_ABLATION',
        'brokerAuthority': False, 'modelPromoted': False}
    return {**payload, 'contentHash': hashed(payload)}
