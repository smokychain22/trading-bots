"""Tests for bots/theta/quant/features/realized_volatility.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import math
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.realized_volatility import (  # noqa: E402
    close_to_close_log_returns,
    close_to_close_realized_volatility,
    ewma_variance_series,
    ewma_volatility,
    fit_har_rv_ols,
    har_rv_features,
    parkinson_realized_volatility,
)


def _synthetic_closes(n: int, daily_return: float = 0.0, start: float = 100.0) -> list:
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


class TestCloseToCloseLogReturns(unittest.TestCase):
    def test_flat_series_has_zero_returns(self):
        returns = close_to_close_log_returns([100.0, 100.0, 100.0])
        self.assertEqual(returns, [0.0, 0.0])

    def test_missing_or_nonpositive_bar_is_skipped_never_a_fabricated_zero_return(self):
        returns = close_to_close_log_returns([100.0, None, 100.0, 0.0, 100.0])
        # (None, ..) pair and (.., None) pair skipped; (0.0, 100.0) pair skipped (non-positive).
        self.assertEqual(returns, [])

    def test_empty_and_singleton_input_return_empty(self):
        self.assertEqual(close_to_close_log_returns([]), [])
        self.assertEqual(close_to_close_log_returns([100.0]), [])


class TestCloseToCloseRealizedVolatility(unittest.TestCase):
    def test_flat_series_has_zero_volatility(self):
        vol = close_to_close_realized_volatility(_synthetic_closes(30, 0.0))
        self.assertAlmostEqual(vol, 0.0, places=9)

    def test_constant_daily_log_return_still_has_zero_volatility(self):
        # Every daily return is IDENTICAL -- sample stdev is honestly 0, not UNKNOWN.
        closes = [100.0 * math.exp(0.001 * i) for i in range(30)]
        vol = close_to_close_realized_volatility(closes)
        self.assertAlmostEqual(vol, 0.0, places=6)

    def test_too_few_observations_is_UNKNOWN_never_a_fabricated_zero(self):
        self.assertIsNone(close_to_close_realized_volatility([100.0]))
        self.assertIsNone(close_to_close_realized_volatility([100.0, 101.0], min_periods=5))

    def test_higher_dispersion_series_reports_higher_volatility(self):
        calm = [100.0, 100.5, 99.8, 100.3, 99.9, 100.4, 100.1, 99.7, 100.6, 100.0]
        wild = [100.0, 110.0, 92.0, 108.0, 90.0, 112.0, 88.0, 115.0, 85.0, 100.0]
        calm_vol = close_to_close_realized_volatility(calm)
        wild_vol = close_to_close_realized_volatility(wild)
        self.assertGreater(wild_vol, calm_vol)


class TestParkinsonRealizedVolatility(unittest.TestCase):
    def test_zero_range_every_bar_gives_zero_volatility(self):
        vol = parkinson_realized_volatility([100.0] * 10, [100.0] * 10)
        self.assertAlmostEqual(vol, 0.0, places=9)

    def test_mismatched_length_raises_rather_than_silently_misaligning(self):
        with self.assertRaises(ValueError):
            parkinson_realized_volatility([100.0, 101.0], [99.0])

    def test_crossed_or_missing_bar_is_skipped_never_coerced(self):
        vol = parkinson_realized_volatility(
            [100.0, None, 90.0, 100.0], [99.0, 98.0, 95.0, 200.0],  # index 3 is crossed (low > high)
        )
        self.assertIsNone(vol)  # only one usable bar (index 2) remains -- below min_periods

    def test_wider_range_reports_higher_volatility_than_narrow_range(self):
        narrow = parkinson_realized_volatility([100.2] * 10, [99.8] * 10)
        wide = parkinson_realized_volatility([110.0] * 10, [90.0] * 10)
        self.assertGreater(wide, narrow)


class TestEwmaVolatility(unittest.TestCase):
    def test_too_short_series_is_UNKNOWN(self):
        self.assertIsNone(ewma_volatility(_synthetic_closes(5), seed_periods=20))

    def test_invalid_decay_lambda_rejected(self):
        with self.assertRaises(ValueError):
            list(ewma_variance_series([0.01, 0.02], decay_lambda=1.0))
        with self.assertRaises(ValueError):
            list(ewma_variance_series([0.01, 0.02], decay_lambda=0.0))

    def test_seed_window_before_seed_periods_is_None_not_a_fabricated_value(self):
        returns = [0.01] * 25
        series = ewma_variance_series(returns, seed_periods=20)
        self.assertTrue(all(value is None for value in series[:19]))
        self.assertIsNotNone(series[19])

    def test_a_late_volatility_shock_raises_the_ewma_estimate(self):
        calm_returns = [0.001, -0.001] * 15
        shocked_returns = calm_returns[:28] + [0.05, -0.05]
        calm_vol = ewma_volatility(_synthetic_closes(31), seed_periods=20)
        # Build closes directly from the shocked return series for a fair comparison.
        shocked_closes = [100.0]
        for r in shocked_returns:
            shocked_closes.append(shocked_closes[-1] * math.exp(r))
        shocked_vol = ewma_volatility(shocked_closes, seed_periods=20)
        self.assertIsNotNone(calm_vol)
        self.assertIsNotNone(shocked_vol)
        self.assertGreater(shocked_vol, calm_vol)


class TestHarRvFeatures(unittest.TestCase):
    def test_never_reads_past_as_of_index_no_lookahead(self):
        series = [0.0001 * (i + 1) for i in range(30)]
        features_at_20 = har_rv_features(series, as_of_index=20)
        # Mutate everything AFTER as_of_index -- the result must be identical.
        series_mutated_future = series[:21] + [999.0] * (len(series) - 21)
        features_at_20_again = har_rv_features(series_mutated_future, as_of_index=20)
        self.assertEqual(features_at_20, features_at_20_again)

    def test_fewer_than_monthly_window_valid_observations_is_UNKNOWN(self):
        series = [0.0001] * 10  # fewer than the default 22-day monthly window
        self.assertIsNone(har_rv_features(series, as_of_index=9))

    def test_a_None_inside_the_monthly_window_makes_the_whole_feature_UNKNOWN(self):
        series = [0.0001] * 22
        series[5] = None
        self.assertIsNone(har_rv_features(series, as_of_index=21))

    def test_out_of_range_as_of_index_raises(self):
        with self.assertRaises(ValueError):
            har_rv_features([0.0001] * 5, as_of_index=10)
        with self.assertRaises(ValueError):
            har_rv_features([0.0001] * 5, as_of_index=-1)

    def test_daily_weekly_monthly_are_computed_from_the_correct_sub_windows(self):
        series = list(range(1, 23))  # 1..22, so monthly window == the whole series
        features = har_rv_features([float(v) for v in series], as_of_index=21, weekly_window=5, monthly_window=22)
        self.assertEqual(features.daily, 22.0)
        self.assertAlmostEqual(features.weekly, sum(range(18, 23)) / 5)
        self.assertAlmostEqual(features.monthly, sum(range(1, 23)) / 22)


class TestFitHarRvOls(unittest.TestCase):
    def test_recovers_known_linear_relationship_on_noise_free_synthetic_data(self):
        # Aperiodic (sum of two incommensurate sinusoids) so the rolling
        # daily/weekly/monthly averages stay linearly independent -- a
        # periodic input can make the normal equations singular once the
        # rolling windows fully "wrap," which would fail this test for a
        # reason unrelated to what it is actually checking.
        rng_series = [0.0001 * (2.0 + math.sin(i * 0.37) + 0.5 * math.cos(i * 0.131)) for i in range(200)]
        features = []
        targets = []
        true_intercept, true_beta_d, true_beta_w, true_beta_m = 0.0002, 0.3, 0.4, 0.3
        for as_of in range(21, 199):
            feature = har_rv_features(rng_series, as_of_index=as_of)
            if feature is None:
                continue
            target = (
                true_intercept + true_beta_d * feature.daily + true_beta_w * feature.weekly + true_beta_m * feature.monthly
            )
            features.append(feature)
            targets.append(target)
        fit = fit_har_rv_ols(features, targets)
        self.assertIsNotNone(fit)
        self.assertAlmostEqual(fit.intercept, true_intercept, places=6)
        self.assertAlmostEqual(fit.beta_daily, true_beta_d, places=6)
        self.assertAlmostEqual(fit.beta_weekly, true_beta_w, places=6)
        self.assertAlmostEqual(fit.beta_monthly, true_beta_m, places=6)

    def test_too_few_observations_is_UNKNOWN_never_a_fabricated_fit(self):
        feature = har_rv_features([0.0001] * 22, as_of_index=21)
        self.assertIsNone(fit_har_rv_ols([feature] * 3, [0.0001, 0.0002, 0.0001]))

    def test_mismatched_lengths_raise(self):
        feature = har_rv_features([0.0001] * 22, as_of_index=21)
        with self.assertRaises(ValueError):
            fit_har_rv_ols([feature] * 5, [0.0001] * 4)


if __name__ == "__main__":
    unittest.main()
