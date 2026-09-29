"""Tests for bots/theta/quant/research/empirical_estimators.py (work
package 39).
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.empirical_estimators import (  # noqa: E402
    avg_win_avg_loss, max_drawdown, mean_return_bootstrap, profit_factor, wilson_interval,
)


class TestWilsonInterval(unittest.TestCase):
    def test_zero_n_is_none_never_a_fabricated_rate(self):
        result = wilson_interval(0, 0)
        self.assertIsNone(result.estimate)
        self.assertIsNone(result.confidence_interval)

    def test_real_estimate_and_interval_bounds_never_exceed_0_1(self):
        result = wilson_interval(3, 5)
        self.assertAlmostEqual(result.estimate, 0.6)
        low, high = result.confidence_interval
        self.assertGreaterEqual(low, 0.0)
        self.assertLessEqual(high, 1.0)
        self.assertLess(low, result.estimate)
        self.assertGreater(high, result.estimate)

    def test_method_and_metadata_are_recorded(self):
        result = wilson_interval(3, 5, cohort="THETA_Q", dataset_hash="abc123")
        self.assertEqual(result.method, "WILSON_INTERVAL")
        self.assertEqual(result.cohort, "THETA_Q")
        self.assertEqual(result.dataset_hash, "abc123")


class TestMeanReturnBootstrap(unittest.TestCase):
    def test_empty_returns_is_none(self):
        result = mean_return_bootstrap([])
        self.assertIsNone(result.estimate)

    def test_real_mean_and_deterministic_seed(self):
        returns = [0.01, 0.02, -0.01, 0.03, -0.02]
        first = mean_return_bootstrap(returns, seed=42)
        second = mean_return_bootstrap(returns, seed=42)
        self.assertAlmostEqual(first.estimate, sum(returns) / len(returns))
        self.assertEqual(first.confidence_interval, second.confidence_interval)  # same seed -> reproducible


class TestProfitFactor(unittest.TestCase):
    def test_real_profit_factor(self):
        self.assertAlmostEqual(profit_factor([100.0, 50.0], [-30.0, -20.0]), 150.0 / 50.0)

    def test_no_losses_is_none_never_infinity(self):
        self.assertIsNone(profit_factor([100.0], []))


class TestAvgWinAvgLoss(unittest.TestCase):
    def test_real_averages(self):
        avg_win, avg_loss = avg_win_avg_loss([100.0, 50.0], [-30.0, -20.0])
        self.assertAlmostEqual(avg_win, 75.0)
        self.assertAlmostEqual(avg_loss, -25.0)

    def test_no_wins_is_none(self):
        avg_win, avg_loss = avg_win_avg_loss([], [-30.0])
        self.assertIsNone(avg_win)
        self.assertAlmostEqual(avg_loss, -30.0)


class TestMaxDrawdown(unittest.TestCase):
    def test_real_drawdown(self):
        self.assertAlmostEqual(max_drawdown([100.0, 120.0, 60.0, 130.0]), (120.0 - 60.0) / 120.0)

    def test_empty_curve_is_none(self):
        self.assertIsNone(max_drawdown([]))

    def test_non_positive_start_is_none(self):
        self.assertIsNone(max_drawdown([0.0, 10.0]))


if __name__ == "__main__":
    unittest.main()
