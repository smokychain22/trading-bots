import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.shadow_prediction_receipt import build_shadow_prediction_receipt


def receipt(**overrides):
    base = dict(model_id='theta-csp-entry-logistic-baseline-v1', model_version='v1', input_hash='a' * 64,
        prediction=0.42, calibration_state='UNCALIBRATED', uncertainty=0.05,
        t0_timestamp='2026-01-01T14:30:00Z', truth_class='MODELED_RESEARCH')
    base.update(overrides)
    return build_shadow_prediction_receipt(**base)


class ShadowPredictionReceiptTests(unittest.TestCase):
    def test_broker_authority_always_false(self):
        self.assertFalse(receipt().broker_authority)

    def test_broker_actual_truth_class_rejected(self):
        with self.assertRaisesRegex(ValueError, 'TRUTH_CLASS_MUST_BE_RESEARCH_TIER'):
            receipt(truth_class='BROKER_ACTUAL')

    def test_synthetic_fixture_allowed(self):
        result = receipt(truth_class='SYNTHETIC_FIXTURE')
        self.assertEqual(result.truth_class, 'SYNTHETIC_FIXTURE')

    def test_missing_input_hash_rejected(self):
        with self.assertRaisesRegex(ValueError, 'INPUT_HASH_REQUIRED'):
            receipt(input_hash='')

    def test_deterministic_hash(self):
        self.assertEqual(receipt(), receipt())

    def test_uncertainty_may_be_none_when_not_computable(self):
        result = receipt(uncertainty=None)
        self.assertIsNone(result.uncertainty)


if __name__ == '__main__':
    unittest.main()
