"""Tests for bots/theta/quant/research/calibration_metrics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.calibration_metrics import (  # noqa: E402
    CalibrationPair,
    brier_score,
    calibration_drift,
    expected_calibration_error,
    log_loss,
    reliability_diagram,
)


class BrierScoreTests(unittest.TestCase):
    def test_perfect_predictions_score_zero(self):
        pairs = [CalibrationPair(1.0, True), CalibrationPair(0.0, False)]
        self.assertAlmostEqual(brier_score(pairs), 0.0)

    def test_maximally_wrong_predictions_score_one(self):
        pairs = [CalibrationPair(0.0, True), CalibrationPair(1.0, False)]
        self.assertAlmostEqual(brier_score(pairs), 1.0)

    def test_uninformative_half_probability_against_mixed_outcomes(self):
        pairs = [CalibrationPair(0.5, True), CalibrationPair(0.5, False)]
        self.assertAlmostEqual(brier_score(pairs), 0.25)

    def test_empty_input_returns_none_never_a_fabricated_perfect_score(self):
        self.assertIsNone(brier_score([]))


class LogLossTests(unittest.TestCase):
    def test_confident_correct_predictions_have_low_log_loss(self):
        pairs = [CalibrationPair(0.99, True), CalibrationPair(0.01, False)]
        self.assertLess(log_loss(pairs), 0.05)

    def test_confident_wrong_predictions_have_high_log_loss(self):
        pairs = [CalibrationPair(0.01, True)]
        self.assertGreater(log_loss(pairs), 4.0)

    def test_empty_input_returns_none(self):
        self.assertIsNone(log_loss([]))

    def test_extreme_probabilities_never_produce_infinity(self):
        pairs = [CalibrationPair(0.0, True), CalibrationPair(1.0, False)]
        result = log_loss(pairs)
        self.assertIsNotNone(result)
        self.assertTrue(result < float("inf"))


class ReliabilityDiagramTests(unittest.TestCase):
    def test_buckets_predictions_by_probability_range(self):
        pairs = [CalibrationPair(0.05, False), CalibrationPair(0.95, True)]
        buckets = reliability_diagram(pairs, n_buckets=10)
        self.assertEqual(buckets[0].n, 1)
        self.assertEqual(buckets[9].n, 1)

    def test_an_empty_bucket_reports_none_never_a_fabricated_value(self):
        pairs = [CalibrationPair(0.05, False)]
        buckets = reliability_diagram(pairs, n_buckets=10)
        empty_bucket = buckets[5]
        self.assertEqual(empty_bucket.n, 0)
        self.assertIsNone(empty_bucket.mean_predicted_probability)
        self.assertIsNone(empty_bucket.empirical_frequency)

    def test_p_equal_to_one_is_clamped_into_the_last_bucket_not_out_of_range(self):
        pairs = [CalibrationPair(1.0, True)]
        buckets = reliability_diagram(pairs, n_buckets=10)
        self.assertEqual(buckets[9].n, 1)

    def test_well_calibrated_bucket_has_matching_mean_prediction_and_frequency(self):
        pairs = [CalibrationPair(0.7, True), CalibrationPair(0.7, True), CalibrationPair(0.7, False)]
        buckets = reliability_diagram(pairs, n_buckets=10)
        bucket = buckets[7]
        self.assertAlmostEqual(bucket.mean_predicted_probability, 0.7)
        self.assertAlmostEqual(bucket.empirical_frequency, 2 / 3)


class ExpectedCalibrationErrorTests(unittest.TestCase):
    def test_perfectly_calibrated_predictions_have_zero_ece(self):
        pairs = [CalibrationPair(0.7, True)] * 7 + [CalibrationPair(0.7, False)] * 3
        self.assertAlmostEqual(expected_calibration_error(pairs, n_buckets=10), 0.0, places=6)

    def test_miscalibrated_predictions_have_positive_ece(self):
        pairs = [CalibrationPair(0.9, False)] * 10
        ece = expected_calibration_error(pairs, n_buckets=10)
        self.assertGreater(ece, 0.5)

    def test_empty_input_returns_none(self):
        self.assertIsNone(expected_calibration_error([]))


class CalibrationDriftTests(unittest.TestCase):
    def test_worsening_calibration_over_time_is_a_positive_drift(self):
        baseline = [CalibrationPair(0.7, True)] * 7 + [CalibrationPair(0.7, False)] * 3  # well calibrated
        recent = [CalibrationPair(0.9, False)] * 10  # badly miscalibrated
        drift = calibration_drift(baseline, recent)
        self.assertGreater(drift, 0.0)

    def test_stable_calibration_has_near_zero_drift(self):
        baseline = [CalibrationPair(0.7, True)] * 7 + [CalibrationPair(0.7, False)] * 3
        recent = [CalibrationPair(0.7, True)] * 7 + [CalibrationPair(0.7, False)] * 3
        self.assertAlmostEqual(calibration_drift(baseline, recent), 0.0, places=6)

    def test_an_empty_window_returns_none_never_a_fabricated_no_drift(self):
        self.assertIsNone(calibration_drift([], [CalibrationPair(0.5, True)]))


if __name__ == "__main__":
    unittest.main()
