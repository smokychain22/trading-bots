"""Tests for bots/theta/quant/features/trend.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.trend import TrendFeatureState, moving_average_slope  # noqa: E402


def _rising_closes(n: int, daily_return: float = 0.01, start: float = 100.0) -> list:
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


class TestMovingAverageSlope(unittest.TestCase):
    def test_current_bar_after_decision_time_is_excluded(self):
        # A series with a real, sharp future spike AFTER as_of_index must not
        # change the result computed as_of an earlier index.
        closes = _rising_closes(40)
        as_of_index = 29
        without_future = moving_average_slope(closes[: as_of_index + 1], as_of_index, ma_window=10, slope_window=5)
        with_future_spike = list(closes)
        with_future_spike[35] = 999999.0  # a future bar, well after as_of_index
        with_future = moving_average_slope(with_future_spike, as_of_index, ma_window=10, slope_window=5, max_bars_since_last=99)
        self.assertEqual(without_future.slope, with_future.slope)
        self.assertEqual(with_future.as_of_index, as_of_index)

    def test_missing_bars_in_window_produce_unknown(self):
        closes = _rising_closes(40)
        closes[20] = None
        result = moving_average_slope(closes, 29, ma_window=10, slope_window=5, max_bars_since_last=99)
        self.assertEqual(result.state, TrendFeatureState.UNKNOWN)
        self.assertIsNone(result.slope)

    def test_insufficient_bars_produce_insufficient_history(self):
        closes = _rising_closes(10)
        result = moving_average_slope(closes, 9, ma_window=10, slope_window=5)
        self.assertEqual(result.state, TrendFeatureState.INSUFFICIENT_HISTORY)
        self.assertIsNone(result.slope)

    def test_stale_bars_produce_stale(self):
        closes = _rising_closes(40)
        # as_of_index far behind the series' last index -> stale.
        result = moving_average_slope(closes, 20, ma_window=10, slope_window=5, max_bars_since_last=1)
        self.assertEqual(result.state, TrendFeatureState.STALE)
        self.assertIsNone(result.slope)

    def test_sign_and_direction_are_deterministic(self):
        rising = moving_average_slope(_rising_closes(40, daily_return=0.02), 39, ma_window=10, slope_window=5)
        falling = moving_average_slope(_rising_closes(40, daily_return=-0.02), 39, ma_window=10, slope_window=5)
        flat = moving_average_slope(_rising_closes(40, daily_return=0.0), 39, ma_window=10, slope_window=5)
        self.assertEqual(rising.state, TrendFeatureState.OK)
        self.assertGreater(rising.slope, 0.0)
        self.assertEqual(falling.state, TrendFeatureState.OK)
        self.assertLess(falling.slope, 0.0)
        self.assertEqual(flat.state, TrendFeatureState.OK)
        self.assertAlmostEqual(flat.slope, 0.0, places=9)
        # Deterministic: calling twice with identical inputs gives the identical result.
        repeat = moving_average_slope(_rising_closes(40, daily_return=0.02), 39, ma_window=10, slope_window=5)
        self.assertEqual(rising.slope, repeat.slope)

    def test_as_of_index_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            moving_average_slope([100.0, 101.0], 5, ma_window=2, slope_window=1)

    def test_invalid_windows_raise(self):
        with self.assertRaises(ValueError):
            moving_average_slope([100.0] * 10, 9, ma_window=1, slope_window=1)
        with self.assertRaises(ValueError):
            moving_average_slope([100.0] * 10, 9, ma_window=2, slope_window=0)


if __name__ == "__main__":
    unittest.main()
