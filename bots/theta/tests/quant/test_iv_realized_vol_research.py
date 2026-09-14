"""Tests for bots/theta/quant/research/iv_realized_vol_research.py. Synthetic fixtures only."""

import math
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.iv_realized_vol_research import (  # noqa: E402
    TRADING_DAYS_PER_YEAR,
    OhlcBar,
    close_to_close_rv,
    compute_vrp,
    garman_klass_rv,
    parkinson_rv,
    rogers_satchell_rv,
)


def _bar(date, o, h, l, c):
    return OhlcBar(date=date, open=o, high=h, low=l, close=c)


class CloseToCloseTests(unittest.TestCase):
    def test_alternating_exact_log_returns_match_hand_computed_stddev(self):
        # Closes chosen so log-returns alternate exactly +r, -r, +r, -r, ...
        r = 0.01
        closes = [100.0]
        for i in range(8):
            step = r if i % 2 == 0 else -r
            closes.append(closes[-1] * math.exp(step))
        bars = [_bar(f"d{i}", c, c, c, c) for i, c in enumerate(closes)]
        result = close_to_close_rv(bars, minimum_sample_size=3)
        self.assertEqual(result.evidence_state, "ESTIMATED")
        returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
        mean_r = sum(returns) / len(returns)
        expected_var = sum((x - mean_r) ** 2 for x in returns) / (len(returns) - 1)
        expected = math.sqrt(expected_var * TRADING_DAYS_PER_YEAR)
        self.assertAlmostEqual(result.annualized_volatility, expected, places=10)

    def test_insufficient_sample_refuses_to_estimate(self):
        bars = [_bar("d0", 100, 100, 100, 100), _bar("d1", 101, 101, 101, 101)]
        result = close_to_close_rv(bars, minimum_sample_size=10)
        self.assertEqual(result.evidence_state, "INSUFFICIENT_DATA")
        self.assertIsNone(result.annualized_volatility)

    def test_invalid_bar_data_refuses_to_estimate(self):
        bars = [_bar("d0", 100, 90, 110, 100), _bar("d1", 101, 101, 101, 101)]  # low > high
        result = close_to_close_rv(bars, minimum_sample_size=1)
        self.assertEqual(result.evidence_state, "INVALID_BAR_DATA")


class RangeEstimatorTests(unittest.TestCase):
    def test_zero_range_bars_yield_near_zero_volatility(self):
        bars = [_bar(f"d{i}", 100, 100, 100, 100) for i in range(5)]
        for fn in (parkinson_rv, garman_klass_rv, rogers_satchell_rv):
            result = fn(bars, minimum_sample_size=3)
            self.assertEqual(result.evidence_state, "ESTIMATED")
            self.assertAlmostEqual(result.annualized_volatility, 0.0, places=6)

    def test_parkinson_positive_for_a_real_range(self):
        bars = [_bar(f"d{i}", 100, 102, 98, 100) for i in range(5)]
        result = parkinson_rv(bars, minimum_sample_size=3)
        self.assertEqual(result.evidence_state, "ESTIMATED")
        self.assertGreater(result.annualized_volatility, 0.0)

    def test_garman_klass_insufficient_sample(self):
        bars = [_bar("d0", 100, 101, 99, 100)]
        result = garman_klass_rv(bars, minimum_sample_size=5)
        self.assertEqual(result.evidence_state, "INSUFFICIENT_DATA")


class VrpAlignmentTests(unittest.TestCase):
    def test_aligned_horizons_produce_vrp_quantities(self):
        rv = close_to_close_rv([_bar(f"d{i}", 100, 100, 100, 100) for i in range(5)], minimum_sample_size=3)
        # zero-vol RV, nonzero IV -> exercise the arithmetic, not the estimator itself
        comparison = compute_vrp(0.25, 30 / 365, rv, 30 / 365, horizon_tolerance_years=1 / 365)
        self.assertTrue(comparison.horizon_aligned)
        self.assertAlmostEqual(comparison.vrp_difference, 0.25 - 0.0)
        self.assertAlmostEqual(comparison.vrp_variance_difference, 0.25 ** 2 - 0.0 ** 2)

    def test_mismatched_horizons_refuse_to_produce_vrp(self):
        rv = close_to_close_rv([_bar(f"d{i}", 100, 100, 100, 100) for i in range(5)], minimum_sample_size=3)
        # 30-day IV vs a 252-day RV horizon -- the classic mismatch this module must refuse.
        comparison = compute_vrp(0.25, 30 / 365, rv, 252 / 365, horizon_tolerance_years=1 / 365)
        self.assertFalse(comparison.horizon_aligned)
        self.assertIsNone(comparison.vrp_difference)
        self.assertIsNone(comparison.vrp_variance_difference)
        self.assertIsNone(comparison.vrp_ratio)

    def test_unknown_iv_refuses_to_produce_vrp_even_when_horizons_align(self):
        rv = close_to_close_rv([_bar(f"d{i}", 100, 100, 100, 100) for i in range(5)], minimum_sample_size=3)
        comparison = compute_vrp(None, 30 / 365, rv, 30 / 365, horizon_tolerance_years=1 / 365)
        self.assertIsNone(comparison.vrp_difference)


if __name__ == "__main__":
    unittest.main()
