import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.controlled_experiment import execute_controlled_experiments
from research.validation_experiment import digest
from research.experiment_registry import R8B_ENTRY_COMPARISONS, R8C_MANAGEMENT_COMPARISONS


def fixture():
    pairs = []
    for identity, _, _ in R8B_ENTRY_COMPARISONS + R8C_MANAGEMENT_COMPARISONS:
        for d in range(3):
            arm = {'policyVersion': 'test-control', 'decisionReceiptHash': 'a' * 64,
                'costModelVersion': 'test-ask-v1', 'outcomeState': 'RESOLVED', 'executionClass': 'MODELED_EXECUTION',
                'units': 'USD_WHOLE_CHAIN_AFTER_COST', 'horizonStart': '2026-01-02T10:00:00Z',
                'horizonEnd': '2026-01-03T10:00:00Z', 'horizonDefinitionVersion': 'test-day-v1',
                'capitalBasis': 'SAME_SECURED_CAPITAL', 'netPnl': 10., 'labelAvailableAt': '2026-01-03T10:00:01Z'}
            if identity in ('R8B-Q-VS-H', 'R8B-Q-VS-D'):
                arm.update(strategyBranch='THETA_CONVENTIONAL', underlying='SPY', comparisonCapitalDollars=50000.,
                    capitalTreatmentVersion='TEST_CARRY_CASH_AFTER_EARLY_EXIT', terminalMarkPolicyVersion='TEST_CLOSE_AT_COMMON_HORIZON')
            pairs.append({'experimentId': identity, 'episodeId': str(d), 'dependencyClusterId': str(d),
                'sourceEvidenceIds': [f'test-{d}'], 'decisionAt': '2026-01-02T10:00:00Z',
                'featureAvailableAt': '2026-01-02T09:00:00Z', 'control': arm,
                'treatment': {**arm, 'policyVersion': 'test-treatment', 'netPnl': float(10 + d)}})
            if identity in ('R8B-Q-VS-H', 'R8B-Q-VS-D'):
                pairs[-1]['treatment']['strategyBranch'] = 'THETA_HOLD_STRIKE' if identity == 'R8B-Q-VS-H' else 'THETA_DEFINED_RISK'
    return {'version': 'theta-controlled-experiment-input-v1', 'evidenceClass': 'DETERMINISTIC_TEST',
        'canonicalSourceSha': 'a' * 40, 'datasetHash': 'b' * 64, 'pairManifestHash': digest(pairs),
        'pairs': pairs, 'evaluatedAt': '2026-01-04T10:00:00Z',
        'policy': {'version': 'test-v1', 'frozenAt': '2026-01-01T00:00:00Z',
                   'minimumIndependentClusters': 3, 'dependencyDefinition': 'test-independent-episodes'}}


class ControlledExperimentsTests(unittest.TestCase):
    def test_all_canonical_24_comparisons_execute_without_promotion(self):
        result = execute_controlled_experiments(fixture())
        self.assertEqual(len(result['results']), 24)
        self.assertTrue(all(r['state'] == 'RUN_COMPLETE_NOT_PROMOTABLE' for r in result['results']))
        self.assertTrue(all(r['clusterMeanIncrementalPnl'] == 1 for r in result['results']))
        self.assertTrue(all(r['effectiveN'] is None for r in result['results']))
        self.assertFalse(result['brokerAuthority'])
        self.assertEqual(result, execute_controlled_experiments(fixture()))

    def test_no_data_is_not_zero_return(self):
        value = fixture(); value['pairs'] = []; value['pairManifestHash'] = digest([])
        result = execute_controlled_experiments(value)
        self.assertTrue(all(r['state'] == 'NOT_RUN_NO_DATA' and r['clusterMeanIncrementalPnl'] is None for r in result['results']))

    def test_censored_cluster_is_retained_and_cannot_inflate_n(self):
        value = fixture(); row = value['pairs'][0]
        row['control'].update(outcomeState='RIGHT_CENSORED', netPnl=None, labelAvailableAt=None)
        value['pairManifestHash'] = digest(value['pairs'])
        first = execute_controlled_experiments(value)['results'][0]
        self.assertEqual(first['state'], 'INSUFFICIENT_N')
        self.assertEqual(first['unresolvedPairs'], 1)

    def test_identity_basis_pit_and_retroactive_policy_fail(self):
        for change, message in ((lambda v: v['pairs'].append(copy.deepcopy(v['pairs'][0])), 'DUPLICATE'),
                (lambda v: v['pairs'][0]['treatment'].update(capitalBasis='OTHER'), 'COMMON_BASIS'),
                (lambda v: v['pairs'][0].update(featureAvailableAt='2026-01-02T11:00:00Z'), 'FUTURE_FEATURE'),
                (lambda v: v['policy'].update(frozenAt='2026-01-04T00:00:00Z'), 'PREREGISTERED')):
            value = fixture(); change(value); value['pairManifestHash'] = digest(value['pairs'])
            with self.assertRaisesRegex(ValueError, message):
                execute_controlled_experiments(value)

    def test_cross_strategy_identity_capital_and_expiry_cash_policy_are_required(self):
        for patch, message in (({'strategyBranch': 'THETA_CONVENTIONAL'}, 'BRANCH_IDENTITY'),
                               ({'comparisonCapitalDollars': None}, 'CAPITAL_AND_TERMINAL'),
                               ({'comparisonCapitalDollars': 25000.}, 'COMMON_BASIS'),
                               ({'capitalTreatmentVersion': ''}, 'CAPITAL_AND_TERMINAL'),
                               ({'underlying': 'QQQ'}, 'COMMON_BASIS')):
            value = fixture()
            row = next(r for r in value['pairs'] if r['experimentId'] == 'R8B-Q-VS-H')
            row['treatment'].update(patch); value['pairManifestHash'] = digest(value['pairs'])
            with self.assertRaisesRegex(ValueError, message):
                execute_controlled_experiments(value)
