"""Tests for bots/theta/quant/features/correlation.py (work package 14)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.correlation import CorrelationPairInput, pearson_correlation, rolling_correlation_result  # noqa: E402


class TestPearsonCorrelation(unittest.TestCase):
    def test_perfectly_correlated_series(self):
        a = [1.0, 2.0, 3.0, 4.0, 5.0]
        b = [2.0, 4.0, 6.0, 8.0, 10.0]
        self.assertAlmostEqual(pearson_correlation(a, b), 1.0, places=9)

    def test_perfectly_anti_correlated_series(self):
        a = [1.0, 2.0, 3.0, 4.0, 5.0]
        b = [10.0, 8.0, 6.0, 4.0, 2.0]
        self.assertAlmostEqual(pearson_correlation(a, b), -1.0, places=9)

    def test_constant_series_is_none_never_fabricated(self):
        self.assertIsNone(pearson_correlation([5.0, 5.0, 5.0], [1.0, 2.0, 3.0]))

    def test_length_mismatch_raises(self):
        with self.assertRaises(ValueError):
            pearson_correlation([1.0, 2.0], [1.0])


class TestRollingCorrelationResult(unittest.TestCase):
    def test_paired_timestamp_alignment_ok(self):
        a = [float(i) for i in range(20)]
        b = [float(i) * 2 for i in range(20)]
        observation = CorrelationPairInput("AAPL", "MSFT", a, b, as_of_index=19, lookback=10)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertAlmostEqual(result.value, 1.0, places=6)

    def test_minimum_sample_insufficient_history(self):
        a = [float(i) for i in range(5)]
        b = [float(i) for i in range(5)]
        observation = CorrelationPairInput("AAPL", "MSFT", a, b, as_of_index=4, lookback=10)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_HISTORY)

    def test_constant_series_handling_is_unknown(self):
        a = [5.0] * 20
        b = [float(i) for i in range(20)]
        observation = CorrelationPairInput("AAPL", "MSFT", a, b, as_of_index=19, lookback=10)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_missing_series_value_is_insufficient_history(self):
        a = [float(i) for i in range(20)]
        b = [float(i) for i in range(20)]
        b[15] = None
        observation = CorrelationPairInput("AAPL", "MSFT", a, b, as_of_index=19, lookback=10)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_HISTORY)

    def test_mismatched_lengths_invalid(self):
        observation = CorrelationPairInput("AAPL", "MSFT", [1.0, 2.0], [1.0], as_of_index=1, lookback=1)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.INVALID)

    def test_no_future_bars_leak_in(self):
        a = [float(i) for i in range(30)]
        b = [float(i) * 2 for i in range(30)]
        as_of_index = 19
        without_future = rolling_correlation_result(
            CorrelationPairInput("AAPL", "MSFT", a[: as_of_index + 1], b[: as_of_index + 1], as_of_index, lookback=10))
        with_future_spike_a = list(a)
        with_future_spike_a[25] = -999999.0
        with_future = rolling_correlation_result(
            CorrelationPairInput("AAPL", "MSFT", with_future_spike_a, b, as_of_index, lookback=10, max_bars_since_last=99))
        self.assertAlmostEqual(without_future.value, with_future.value)

    def test_stale_is_stale(self):
        a = [float(i) for i in range(30)]
        b = [float(i) * 2 for i in range(30)]
        observation = CorrelationPairInput("AAPL", "MSFT", a, b, as_of_index=15, lookback=10, max_bars_since_last=1)
        result = rolling_correlation_result(observation)
        self.assertEqual(result.state, FeatureResultState.STALE)


if __name__ == "__main__":
    unittest.main()
