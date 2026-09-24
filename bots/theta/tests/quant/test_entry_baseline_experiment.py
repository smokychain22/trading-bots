import sys
import unittest
import copy
import tempfile
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_entry_episode_training import policy as feature_policy, training_fixture
from test_empirical_pipeline import _config
from research.production_export_loader import load_dataset_export
from research.entry_episode_training import build_entry_episode_training_dataset
from research.entry_baseline_experiment import execute_entry_baseline, hashed
from research.empirical_pipeline import run_theta_empirical_pipeline


def policy():
    return {'version': 'theta-entry-baseline-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'frozenAt': '2025-12-01T00:00:00Z', 'minimumTrainingRows': 2, 'minimumClassRows': 1,
        'minimumCalibrationRows': 2, 'calibrationBins': 2, 'embargoSeconds': 60,
        'optimizer': {'l2_penalty': 1., 'learning_rate': .1, 'max_iterations': 5000, 'convergence_tolerance': 1e-7},
        'splitConfig': {'train_groups': 2, 'validation_groups': 2, 'forward_groups': 2,
                        'step_groups': 8, 'embargo_groups': 0, 'final_oos_groups': 1}}


def fixture():
    dataset = build_entry_episode_training_dataset(load_dataset_export(training_fixture()), feature_policy())
    prototype = dataset['rows'][0]
    dataset['rows'] = []
    for day in range(1, 9):
        row = copy.deepcopy(prototype)
        row.update({'observationId': str(day), 'economicChainId': str(day), 'dependencyGroupId': str(day),
            'features': [100. + day, 16., 1. + (day % 2), .02], 'positiveWholeChainLabel': day % 2,
            'wholeChainAfterCostPnl': 20. if day % 2 else -20.,
            'decisionAt': f'2026-01-{day:02d}T10:00:00Z', 'featureAvailableAt': f'2026-01-{day:02d}T09:59:59Z',
            'labelAvailableAt': f'2026-01-{day:02d}T20:00:00Z', 'labelWindowEnd': f'2026-01-{day:02d}T19:00:00Z'})
        dataset['rows'].append(row)
    dataset['rowCount'] = 8
    return rehash(dataset)


def rehash(value):
    value['contentHash'] = hashed({k: v for k, v in value.items() if k != 'contentHash'})
    return value


class EntryBaselineTests(unittest.TestCase):
    def test_train_calibrate_forward_registry_end_to_end_and_reproducible(self):
        result = execute_entry_baseline(fixture(), policy(), '2026-01-10T00:00:00Z')
        self.assertEqual(result['state'], 'RESEARCH_FORWARD_EVALUATED')
        self.assertEqual(result['registry'][0]['model']['trainIds'], ['1', '2'])
        self.assertEqual(result['registry'][0]['model']['target'], 'WHOLE_CHAIN_AFTER_COST_POSITIVE')
        self.assertEqual(result['folds'][0]['calibration']['ISOTONIC']['metrics']['sample_size'], 2)
        self.assertEqual(result['plan']['plan']['final_oos_ids'], ['8'])
        self.assertFalse(result['modelPromoted'])
        self.assertFalse(result['finalOosEvaluated'])
        self.assertEqual(result, execute_entry_baseline(fixture(), policy(), '2026-01-10T00:00:00Z'))

    def test_forward_and_oos_values_cannot_change_training_or_scaler(self):
        raw = fixture()
        original = execute_entry_baseline(raw, policy(), '2026-01-10T00:00:00Z')
        for row in raw['rows'][4:]:
            row['features'][0] = 9999.
            row['positiveWholeChainLabel'] = 1 - row['positiveWholeChainLabel']
        changed = execute_entry_baseline(rehash(raw), policy(), '2026-01-10T00:00:00Z')
        for key in ('fit', 'means', 'scales', 'constantFeatureIndices'):
            self.assertEqual(original['registry'][0]['model'][key], changed['registry'][0]['model'][key])
        self.assertEqual(original['registry'][0]['calibration']['ISOTONIC']['model'],
                         changed['registry'][0]['calibration']['ISOTONIC']['model'])

    def test_immature_labels_purge_entire_training_group(self):
        raw = fixture(); raw['rows'][0]['labelAvailableAt'] = '2026-01-04T20:00:00Z'
        result = execute_entry_baseline(rehash(raw), policy(), '2026-01-10T00:00:00Z')
        self.assertEqual(result['state'], 'INSUFFICIENT_ELIGIBLE_EVIDENCE')
        self.assertEqual(result['registry'], [])

    def test_single_class_and_optimizer_nonconvergence_never_register_model(self):
        raw = fixture(); raw['rows'][0]['positiveWholeChainLabel'] = 0
        result = execute_entry_baseline(rehash(raw), policy(), '2026-01-10T00:00:00Z')
        self.assertEqual(result['registry'], [])
        p = policy(); p['optimizer']['max_iterations'] = 1
        result = execute_entry_baseline(fixture(), p, '2026-01-10T00:00:00Z')
        self.assertEqual(result['folds'][0]['state'], 'OPTIMIZER_NOT_CONVERGED')
        self.assertEqual(result['registry'], [])

    def test_hash_tampering_and_future_labels_fail(self):
        raw = fixture(); raw['rows'][0]['features'][0] += 1
        with self.assertRaisesRegex(ValueError, 'HASH'):
            execute_entry_baseline(raw, policy(), '2026-01-10T00:00:00Z')
        with self.assertRaisesRegex(ValueError, 'NOT_YET_AVAILABLE'):
            execute_entry_baseline(fixture(), policy(), '2026-01-02T00:00:00Z')

    def test_canonical_pipeline_persists_insufficient_fit_as_real_state(self):
        with tempfile.TemporaryDirectory(prefix='theta-entry-baseline-test-') as folder:
            result = run_theta_empirical_pipeline(training_fixture(), _config(), output_root=Path(folder),
                entry_training_policy=feature_policy(), entry_baseline_policy=policy(), run_timestamp='2026-01-10T00:00:00Z')
            artifact = next(Path(p) for p in result.artifacts_written if p.endswith('entry_baseline_experiment.json'))
            receipt = json.loads(artifact.read_text())
            self.assertEqual(receipt['state'], 'INSUFFICIENT_ELIGIBLE_EVIDENCE')
            self.assertEqual(receipt['registry'], [])
            self.assertEqual(receipt['productionEvModel'], 'EV_MODEL_NOT_EMPIRICALLY_READY')
