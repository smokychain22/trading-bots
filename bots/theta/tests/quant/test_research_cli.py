import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _candidate_raw
from research.research_cli import _dispatch


class ResearchCliMissingnessTests(unittest.TestCase):
    def test_missingness_subcommand(self):
        result = _dispatch('missingness', {
            'records': [{'value': 1.0, 'feature': 'IV'}, {'value': None, 'feature': 'IV'}],
            'valueKey': 'value', 'dimensions': ['feature'],
        })
        self.assertEqual(result['missingTotal'], 1)


class ResearchCliCoverageTests(unittest.TestCase):
    def test_management_and_regime_materialize_verified_export_with_explicit_policy(self):
        from test_management_dataset import fixture, policy as management_policy
        from test_regime_dataset import policy as regime_policy
        for command, policy in [('management-dataset', management_policy()), ('regime-dataset', regime_policy())]:
            result = _dispatch(command, {'export': fixture(), 'policy': policy})
            self.assertGreater(result['rowCount'], 0)
            self.assertEqual(len(result['contentHash']), 64)
            broken = fixture()
            broken['datasetHash'] = '0' * 64
            from research.production_export_loader import DatasetLoadError
            with self.assertRaises(DatasetLoadError):
                _dispatch(command, {'export': broken, 'policy': policy})

    def test_coverage_subcommand(self):
        result = _dispatch('coverage', {'candidates': [_candidate_raw(candidate_id='c1')]})
        self.assertEqual(result['uniqueCandidateCount'], 1)


class ResearchCliStrictnessTests(unittest.TestCase):
    def test_strictness_subcommand(self):
        result = _dispatch('strictness', {'rows': [
            {'strategy': 'THETA_CONVENTIONAL', 'date': '2026-01-01', 'reasonCode': 'ECONOMIC_VALUE_INSUFFICIENT', 'candidateId': 'c1'},
        ]})
        self.assertEqual(result['totalCount'], 1)


class ResearchCliBenchmarkTests(unittest.TestCase):
    def test_benchmark_single_id_subcommand(self):
        result = _dispatch('benchmark', {'benchmarkId': 'B0'})
        self.assertEqual(result['state'], 'RUNNER_IMPLEMENTED_DATA_AVAILABLE')

    def test_benchmark_all_ids_subcommand(self):
        result = _dispatch('benchmark', {})
        self.assertGreater(len(result), 20)

    def test_benchmark_execution_subcommand(self):
        result = _dispatch('benchmark', {'execute': True, 'benchmarkId': 'B6',
            'benchmarkInput': {'policyVersion': 'benchmark-test-v1', 'entryPrice': 100.0, 'exitPrice': 110.0}})
        self.assertEqual(result['state'], 'EXECUTED')
        self.assertAlmostEqual(result['result']['return'], .1)


class ResearchCliCalibrationTests(unittest.TestCase):
    def test_calibration_subcommand(self):
        result = _dispatch('calibration', {'probabilities': [0.5, 0.5], 'labels': [1, 0], 'binCount': 2})
        self.assertEqual(result['sampleSize'], 2)


class ResearchCliReproducibilityVerifyTests(unittest.TestCase):
    def test_reproducibility_verify_subcommand(self):
        from research.reproducibility_bundle import build_reproducibility_bundle
        bundle = build_reproducibility_bundle(
            sourceSha='a' * 40, datasetHash='b' * 64, configHash='c' * 64, featureVersion='fv-1',
            labelVersion='lv-1', modelVersion='mv-1', splitHash='d' * 64, seed=42,
            experimentId='EXP-1', metricHash='e' * 64,
        )
        result = _dispatch('reproducibility-verify', {'bundle': bundle})
        self.assertTrue(result['verified'])


class ResearchCliAuthorityRoutingTests(unittest.TestCase):
    def test_features_validates_and_lists_the_real_registry(self):
        result = _dispatch('features', {})
        self.assertEqual(result['state'], 'REGISTRY_VALID')
        self.assertGreater(result['featureFamilyCount'], 0)
        self.assertFalse(result['brokerAuthority'])

    def test_typescript_authorities_are_not_duplicated_in_python(self):
        expected = {
            'dataset-build': 'tools/theta-research-dataset-cli.ts',
            'filter-value': 'src/research/filter-value-analysis-engine.ts',
        }
        for command, implementation in expected.items():
            result = _dispatch(command, {})
            self.assertEqual(result['state'], 'CANONICAL_TYPESCRIPT_PATH')
            self.assertEqual(result['implementation'], implementation)


class ResearchCliUnknownCommandTests(unittest.TestCase):
    def test_unknown_command_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_COMMAND'):
            _dispatch('not-a-real-command', {})


if __name__ == '__main__':
    unittest.main()
