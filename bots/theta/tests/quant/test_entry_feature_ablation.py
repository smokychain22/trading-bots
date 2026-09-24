import sys
import unittest
import json
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_entry_baseline_experiment import fixture, policy as baseline_policy
from test_entry_episode_training import training_fixture, policy as feature_policy
from test_empirical_pipeline import _config
from research.entry_feature_ablation import execute_entry_feature_ablation
from research.empirical_pipeline import run_theta_empirical_pipeline


def policy():
    return {'version': 'theta-entry-feature-ablation-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'frozenAt': '2025-12-01T00:00:00Z', 'variants': [
            {'name': 'WITHOUT_BID', 'featureNames': ['strike', 'dte', 'relativeSpread']},
            {'name': 'WITHOUT_STRIKE', 'featureNames': ['dte', 'bid', 'relativeSpread']}]}


class EntryAblationTests(unittest.TestCase):
    def test_real_runner_refits_subsets_on_identical_rows_and_splits(self):
        result = execute_entry_feature_ablation(fixture(), baseline_policy(), policy(), '2026-01-10T00:00:00Z')
        self.assertEqual(len(result['comparisons']), 2)
        for comparison in result['comparisons']:
            self.assertEqual(comparison['state'], 'PAIRED_FORWARD_COMPARISON')
            self.assertEqual(comparison['experiment']['plan'], result['baseline']['plan'])
            self.assertEqual(comparison['dependencyComponentCount'], 2)
            self.assertIsNone(comparison['effectiveIndependentN'])
            self.assertIsNotNone(comparison['meanPairedDelta'])
        self.assertFalse(result['finalOosTouched'])
        self.assertEqual(result['economicValueConclusion'], 'NOT_ESTABLISHED_BY_PREDICTIVE_ABLATION')
        self.assertEqual(result, execute_entry_feature_ablation(fixture(), baseline_policy(), policy(), '2026-01-10T00:00:00Z'))

    def test_unknown_or_duplicate_features_fail_before_fit(self):
        for features in (['gex'], ['bid', 'bid'], [], fixture()['featureNames']):
            p = policy(); p['variants'][0]['featureNames'] = features
            with self.assertRaisesRegex(ValueError, 'STRICT_FEATURE_SUBSET'):
                execute_entry_feature_ablation(fixture(), baseline_policy(), p, '2026-01-10T00:00:00Z')

    def test_insufficient_evidence_never_becomes_zero_improvement(self):
        p = baseline_policy(); p['minimumTrainingRows'] = 100
        result = execute_entry_feature_ablation(fixture(), p, policy(), '2026-01-10T00:00:00Z')
        for comparison in result['comparisons']:
            self.assertIsNone(comparison['meanPairedDelta'])
            self.assertIsNone(comparison['componentMeanStandardError'])
            self.assertTrue(comparison['unmatchedFolds'])

    def test_pipeline_wires_and_persists_partial_ablation_receipt(self):
        with tempfile.TemporaryDirectory(prefix='theta-ablation-test-') as folder:
            result = run_theta_empirical_pipeline(training_fixture(), _config(), output_root=Path(folder),
                entry_training_policy=feature_policy(), entry_baseline_policy=baseline_policy(),
                entry_ablation_policy=policy(), run_timestamp='2026-01-10T00:00:00Z')
            artifact = next(Path(p) for p in result.artifacts_written if p.endswith('entry_feature_ablation.json'))
            receipt = json.loads(artifact.read_text())
            self.assertEqual(len(receipt['comparisons']), 2)
            self.assertFalse(receipt['brokerAuthority'])
            self.assertIsNone(receipt['comparisons'][0]['meanPairedDelta'])
