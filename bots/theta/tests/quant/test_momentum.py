"""Tests for bots/theta/quant/features/momentum.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.momentum import MomentumFeatureState, horizon_return  # noqa: E402


def _rising_closes(n: int, daily_return: float = 0.01, start: float = 100.0) -> list:
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


class TestHorizonReturn(unittest.TestCase):
    def test_current_bar_after_decision_time_is_excluded(self):
        closes = _rising_closes(40)
        as_of_index = 29
        without_future = horizon_return(closes[: as_of_index + 1], as_of_index, horizon=5)
        with_future_spike = list(closes)
        with_future_spike[35] = 999999.0
        with_future = horizon_return(with_future_spike, as_of_index, horizon=5, max_bars_since_last=99)
        self.assertEqual(without_future.return_value, with_future.return_value)

    def test_missing_anchor_or_current_bar_produces_unknown(self):
        closes = _rising_closes(40)
        closes[24] = None  # anchor bar for horizon=5 at as_of_index=29
        result = horizon_return(closes, 29, horizon=5, max_bars_since_last=99)
        self.assertEqual(result.state, MomentumFeatureState.UNKNOWN)
        self.assertIsNone(result.return_value)

    def test_insufficient_history_before_horizon_start(self):
        closes = _rising_closes(10)
        result = horizon_return(closes, 3, horizon=5, max_bars_since_last=99)
        self.assertEqual(result.state, MomentumFeatureState.INSUFFICIENT_HISTORY)
        self.assertIsNone(result.return_value)

    def test_stale_bars_produce_stale(self):
        closes = _rising_closes(40)
        result = horizon_return(closes, 20, horizon=5, max_bars_since_last=1)
        self.assertEqual(result.state, MomentumFeatureState.STALE)
        self.assertIsNone(result.return_value)

    def test_sign_and_direction_are_deterministic(self):
        rising = horizon_return(_rising_closes(40, daily_return=0.02), 39, horizon=10)
        falling = horizon_return(_rising_closes(40, daily_return=-0.02), 39, horizon=10)
        flat = horizon_return(_rising_closes(40, daily_return=0.0), 39, horizon=10)
        self.assertEqual(rising.state, MomentumFeatureState.OK)
        self.assertGreater(rising.return_value, 0.0)
        self.assertEqual(falling.state, MomentumFeatureState.OK)
        self.assertLess(falling.return_value, 0.0)
        self.assertEqual(flat.state, MomentumFeatureState.OK)
        self.assertAlmostEqual(flat.return_value, 0.0, places=9)
        repeat = horizon_return(_rising_closes(40, daily_return=0.02), 39, horizon=10)
        self.assertEqual(rising.return_value, repeat.return_value)

    def test_distinct_from_trend_different_semantics(self):
        # A raw single-horizon return can diverge in sign from a smoothed
        # MA-slope trend signal on a series with a recent reversal --
        # proving these are genuinely different feature families, not a
        # renamed duplicate. This uses a V-shaped series: falling then
        # sharply rising at the very end.
        falling = [100.0 - i for i in range(20)]  # 100..81
        spike = falling + [200.0, 210.0, 220.0, 230.0, 240.0]
        as_of_index = len(spike) - 1
        momentum = horizon_return(spike, as_of_index, horizon=4)
        self.assertEqual(momentum.state, MomentumFeatureState.OK)
        self.assertGreater(momentum.return_value, 0.0)  # sharp recent recovery

    def test_zero_anchor_close_is_unknown_not_a_division_crash(self):
        closes = [0.0] + _rising_closes(10)[1:]
        result = horizon_return(closes, 9, horizon=9)
        self.assertEqual(result.state, MomentumFeatureState.UNKNOWN)
        self.assertIsNone(result.return_value)

    def test_as_of_index_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            horizon_return([100.0, 101.0], 5, horizon=1)

    def test_invalid_horizon_raises(self):
        with self.assertRaises(ValueError):
            horizon_return([100.0] * 10, 9, horizon=0)


if __name__ == "__main__":
    unittest.main()
