"""Applies the generic pit_leakage_harness.py (work package 82) across
several real, already-independently-tested modules (trend.py, momentum.py,
realized_volatility.py) to prove the harness itself works generically --
not a replacement for those modules' own dedicated leakage tests.
"""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.pit_leakage_harness import assert_pit_invariant
from features.trend import moving_average_slope
from features.momentum import horizon_return
from features.realized_volatility import close_to_close_realized_volatility_result


CLOSES = [100.0, 101.0, 99.0, 102.0, 103.0, 104.0, 101.0, 105.0, 106.0, 107.0,
          108.0, 109.0, 110.0, 111.0, 112.0, 113.0, 114.0, 115.0, 116.0, 117.0,
          118.0, 119.0, 120.0, 121.0, 122.0, 123.0]


class PitLeakageHarnessAppliedTests(unittest.TestCase):
    def test_moving_average_slope_is_pit_safe_via_generic_harness(self):
        # as_of stays well before the array end (matching real max_bars_since_last
        # usage, which measures staleness from the array's own end, i.e. "now") --
        # only the bars strictly AFTER as_of are mutated, array length unchanged,
        # so "now" and staleness are held fixed and only future VALUES vary.
        as_of = 15
        mutated = list(CLOSES)
        mutated[as_of + 1:] = [999.0, 998.0, 5.0, -1.0, 0.0, 42.0, 7.0, 8.0, 9.0, 10.0]
        assert_pit_invariant(
            moving_average_slope, before_args=(CLOSES, as_of, 10, 5, 100), after_args=(tuple(mutated), as_of, 10, 5, 100),
        )

    def test_horizon_return_is_pit_safe_via_generic_harness(self):
        as_of = 15
        mutated = list(CLOSES)
        mutated[as_of + 1:] = [999.0, 998.0, 5.0, -1.0, 0.0, 42.0, 7.0, 8.0, 9.0, 10.0]
        assert_pit_invariant(
            horizon_return, before_args=(CLOSES, as_of, 5, 100), after_args=(tuple(mutated), as_of, 5, 100),
        )

    def test_realized_volatility_is_pit_safe_via_generic_harness(self):
        as_of = 15
        mutated = list(CLOSES)
        mutated[as_of + 1:] = [999.0, 998.0, 5.0, -1.0, 0.0, 42.0, 7.0, 8.0, 9.0, 10.0]
        assert_pit_invariant(
            close_to_close_realized_volatility_result, before_args=(CLOSES, as_of, 10, 252.0, 100),
            after_args=(tuple(mutated), as_of, 10, 252.0, 100),
        )

    def test_harness_itself_detects_a_real_leak(self):
        def leaky(series, as_of_index):
            return series[-1]  # deliberately reads the LAST element, not as_of_index -- a real leak
        with self.assertRaisesRegex(AssertionError, 'PIT_LEAKAGE_DETECTED'):
            assert_pit_invariant(leaky, before_args=(CLOSES, 5), after_args=(CLOSES + [999.0], 5))


if __name__ == '__main__':
    unittest.main()
