import sys
from pathlib import Path
import unittest
import json
import os
import subprocess
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.validation_experiment import execute_validation_experiment, digest


def fixture():
    observations = [{'observation_id': str(d), 'economic_chain_id': str(d),
        'observed_at': f'2026-01-{d:02d}T10:00:00Z', 'feature_available_at': f'2026-01-{d:02d}T09:00:00Z',
        'label_available_at': f'2026-01-{d:02d}T16:00:00Z', 'label_window_end': f'2026-01-{d:02d}T15:00:00Z'} for d in range(1, 9)]
    predictions = {str(d): {'modelVersion': 'DETERMINISTIC_TEST_ONLY', 'evidenceId': f'p-{d}',
        'trainingObservationIds': ['1', '2'], 'availableAt': f'2026-01-{d:02d}T09:59:00Z',
        'score': float(d % 2), 'label': d % 2} for d in range(3, 8)}
    return {'version': 'theta-validation-experiment-input-v1', 'sourceSha': 'a' * 40,
            'evidenceClass': 'DETERMINISTIC_TEST', 'observations': observations,
            'observationManifestHash': digest(observations), 'policyVersion': 'test-v1',
            'splitConfig': {'train_groups': 2, 'validation_groups': 2, 'forward_groups': 2,
                            'step_groups': 8, 'embargo_groups': 0, 'final_oos_groups': 1},
            'embargoSeconds': 60, 'minimumCalibrationSamples': 2, 'calibrationBins': 2,
            'predictions': predictions, 'predictionManifestHash': digest(predictions)}


class ValidationExecutionTests(unittest.TestCase):
    def test_real_dispatch_calibrates_validation_and_scores_forward_only(self):
        result = execute_validation_experiment(fixture())
        self.assertEqual(result['folds'][0]['state'], 'EXECUTED')
        self.assertEqual(result['folds'][0]['calibration']['ISOTONIC']['metrics']['sample_size'], 2)
        self.assertFalse(result['finalOosEvaluated'])
        self.assertFalse(result['modelPromoted'])
        self.assertEqual(result, execute_validation_experiment(fixture()))

    def test_missing_predictions_do_not_generate_fake_metrics(self):
        value = fixture(); value['predictions'] = {}
        value['predictionManifestHash'] = digest(value['predictions'])
        result = execute_validation_experiment(value)
        self.assertEqual(result['folds'][0]['state'], 'FORWARD_DATA_REQUIRED')

    def test_model_trained_on_forward_labels_is_rejected(self):
        value = fixture(); value['predictions']['3']['trainingObservationIds'] = ['6']
        value['predictionManifestHash'] = digest(value['predictions'])
        with self.assertRaisesRegex(ValueError, 'OUTSIDE_PURGED_TRAIN'):
            execute_validation_experiment(value)

    def test_mixed_base_models_cannot_share_one_calibrator(self):
        value = fixture(); value['predictions']['3']['modelVersion'] = 'other-model'
        value['predictionManifestHash'] = digest(value['predictions'])
        with self.assertRaisesRegex(ValueError, 'MODEL_IDENTITY_MISMATCH'):
            execute_validation_experiment(value)

    def test_prediction_revision_requires_new_manifest(self):
        value = fixture(); value['predictions']['3']['label'] = 0
        with self.assertRaisesRegex(ValueError, 'PREDICTION_MANIFEST_HASH_MISMATCH'):
            execute_validation_experiment(value)

    def test_changed_manifest_cannot_be_silently_reused(self):
        value = fixture(); value['observations'][0]['observed_at'] = '2026-01-01T11:00:00Z'
        with self.assertRaisesRegex(ValueError, 'MANIFEST_HASH_MISMATCH'):
            execute_validation_experiment(value)

    def test_offline_cli_persists_reloadable_receipt_and_refuses_overwrite(self):
        root = Path(__file__).resolve().parents[4]
        value = fixture()
        value['sourceSha'] = subprocess.check_output(['git', 'rev-parse', 'origin/main'], cwd=root, text=True).strip()
        environment = {**os.environ, 'PYTHONPATH': str(root / 'bots/theta/quant')}
        with tempfile.TemporaryDirectory(prefix='theta-validation-test-') as directory:
            source = Path(directory) / 'input.json'
            output = Path(directory) / 'receipt.json'
            source.write_text(json.dumps(value), encoding='utf-8')
            command = [sys.executable, '-m', 'research.validation_experiment', '--input', str(source), '--output', str(output)]
            result = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(receipt, json.loads(json.dumps(execute_validation_experiment(value))))
            self.assertFalse(receipt['brokerAuthority'])
            self.assertEqual(sum(b['count'] for b in receipt['folds'][0]['calibration']['ISOTONIC']['metrics']['reliability_bins']), 2)
            old = output.read_bytes()
            repeated = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertEqual(output.read_bytes(), old)
