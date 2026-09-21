"""Tests for bots/theta/quant/calibration/severe_drawdown_logistic_baseline.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from calibration.severe_drawdown_logistic_baseline import (  # noqa: E402
    LogisticTrainingRow,
    chronological_train_test_split,
    evaluate_calibration,
    fit_logistic_regression,
    predict_probability,
)


def _linearly_separable_rows(n: int = 60):
    rows = []
    for i in range(n):
        x = (i - n / 2) / (n / 2)  # ranges roughly -1..1
        label = 1 if x > 0 else 0
        rows.append(LogisticTrainingRow(features=(x,), label=label))
    return rows


class SevereDrawdownLogisticBaselineTest(unittest.TestCase):
    def test_fit_is_deterministic_across_repeated_runs_on_identical_input(self):
        rows = _linearly_separable_rows()
        fit1 = fit_logistic_regression(rows, l2_penalty=1.0, max_iterations=500)
        fit2 = fit_logistic_regression(rows, l2_penalty=1.0, max_iterations=500)
        self.assertEqual(fit1.weights, fit2.weights)
        self.assertEqual(fit1.bias, fit2.bias)

    def test_fit_learns_the_correct_sign_of_separation(self):
        rows = _linearly_separable_rows()
        fit = fit_logistic_regression(rows, l2_penalty=0.1, max_iterations=2000)
        self.assertGreater(fit.weights[0], 0.0)
        p_high = predict_probability(fit, (0.9,))
        p_low = predict_probability(fit, (-0.9,))
        self.assertGreater(p_high, 0.5)
        self.assertLess(p_low, 0.5)

    def test_rejects_empty_training_set_and_mismatched_feature_lengths(self):
        with self.assertRaises(ValueError):
            fit_logistic_regression([])
        with self.assertRaises(ValueError):
            fit_logistic_regression([
                LogisticTrainingRow(features=(1.0,), label=1),
                LogisticTrainingRow(features=(1.0, 2.0), label=0),
            ])
        with self.assertRaises(ValueError):
            fit_logistic_regression([LogisticTrainingRow(features=(1.0,), label=1)], l2_penalty=-1.0)

    def test_predict_probability_rejects_mismatched_feature_vector_length(self):
        fit = fit_logistic_regression(_linearly_separable_rows(), max_iterations=50)
        with self.assertRaises(ValueError):
            predict_probability(fit, (1.0, 2.0))

    def test_evaluate_calibration_reports_zero_brier_and_log_loss_for_perfect_confident_predictions(self):
        report = evaluate_calibration([0.999999999999, 0.000000000001], [1, 0])
        self.assertAlmostEqual(report.brier_score, 0.0, places=6)
        self.assertLess(report.log_loss, 1e-6)

    def test_evaluate_calibration_reports_high_error_for_confidently_wrong_predictions(self):
        report = evaluate_calibration([0.01, 0.99], [1, 0])
        self.assertGreater(report.brier_score, 0.9)
        self.assertGreater(report.log_loss, 4.0)

    def test_evaluate_calibration_rejects_length_mismatch_and_empty_input(self):
        with self.assertRaises(ValueError):
            evaluate_calibration([0.5], [1, 0])
        with self.assertRaises(ValueError):
            evaluate_calibration([], [])

    def test_reliability_bins_report_none_never_zero_for_an_empty_bin(self):
        report = evaluate_calibration([0.05, 0.95], [0, 1], n_bins=10)
        empty_bin = report.reliability_bins[5]  # 0.5-0.6 bucket, nothing falls there
        self.assertEqual(empty_bin.n, 0)
        self.assertIsNone(empty_bin.mean_predicted)
        self.assertIsNone(empty_bin.empirical_rate)

    def test_chronological_split_never_shuffles_and_keeps_the_latest_rows_as_the_untouched_test_set(self):
        dated_rows = [
            (f"2026-01-{i:02d}", LogisticTrainingRow(features=(float(i),), label=i % 2))
            for i in range(1, 21)
        ]
        train, test = chronological_train_test_split(dated_rows, test_fraction=0.3)
        train_features = {row.features[0] for row in train}
        test_features = {row.features[0] for row in test}
        self.assertEqual(train_features | test_features, set(range(1, 21)))
        self.assertTrue(max(train_features) < min(test_features))

    def test_chronological_split_rejects_an_out_of_range_test_fraction(self):
        with self.assertRaises(ValueError):
            chronological_train_test_split([("2026-01-01", LogisticTrainingRow(features=(1.0,), label=1))], test_fraction=0.0)
        with self.assertRaises(ValueError):
            chronological_train_test_split([("2026-01-01", LogisticTrainingRow(features=(1.0,), label=1))], test_fraction=1.0)


if __name__ == "__main__":
    unittest.main()
