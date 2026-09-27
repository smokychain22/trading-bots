import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.paper_model_discrepancy import (
    assignment_error, cost_model_error, fill_price_error, fill_probability_calibration_drift,
    fill_probability_error, management_rtg_error, slippage_error,
)


class ErrorFunctionTests(unittest.TestCase):
    def test_fill_probability_error_real(self):
        self.assertAlmostEqual(fill_probability_error(0.7, True), -0.3)
        self.assertAlmostEqual(fill_probability_error(0.7, False), 0.7)

    def test_fill_probability_error_none_when_either_side_missing(self):
        self.assertIsNone(fill_probability_error(None, True))
        self.assertIsNone(fill_probability_error(0.7, None))

    def test_fill_price_error(self):
        self.assertAlmostEqual(fill_price_error(1.05, 1.0), 0.05)
        self.assertIsNone(fill_price_error(None, 1.0))

    def test_slippage_error(self):
        self.assertAlmostEqual(slippage_error(0.02, 0.05), -0.03)
        self.assertIsNone(slippage_error(0.02, None))

    def test_assignment_error(self):
        self.assertAlmostEqual(assignment_error(0.3, True), -0.7)
        self.assertIsNone(assignment_error(None, None))

    def test_management_rtg_error(self):
        self.assertAlmostEqual(management_rtg_error(1.0, 0.5), 0.5)
        self.assertIsNone(management_rtg_error(1.0, None))

    def test_cost_model_error(self):
        self.assertAlmostEqual(cost_model_error(2.0, 2.5), -0.5)
        self.assertIsNone(cost_model_error(None, 2.5))


class FillProbabilityCalibrationDriftTests(unittest.TestCase):
    def test_insufficient_sample(self):
        result = fill_probability_calibration_drift([0.5], [1], bin_count=2, minimum_n=10)
        self.assertEqual(result['state'], 'INSUFFICIENT_SAMPLE')

    def test_sufficient_sample_reuses_real_calibration_metrics(self):
        probabilities = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 0.5]
        labels = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
        result = fill_probability_calibration_drift(probabilities, labels, bin_count=5, minimum_n=5)
        self.assertEqual(result['state'], 'EVALUATED')
        self.assertEqual(result['metrics'].sample_size, 10)

    def test_length_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'LENGTH_MISMATCH'):
            fill_probability_calibration_drift([0.5, 0.6], [1], bin_count=2, minimum_n=1)


if __name__ == '__main__':
    unittest.main()
