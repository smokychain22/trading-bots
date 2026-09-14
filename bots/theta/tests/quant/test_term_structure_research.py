"""Tests for bots/theta/quant/research/term_structure_research.py. Synthetic fixtures only."""

import math
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.term_structure_research import (  # noqa: E402
    TermMethod,
    TermMethodComparison,
    TermQuotePoint,
    all_strike_mean_term,
    atm_relative_term,
    forward_variance_term,
    matched_log_moneyness_term,
    provider_term_metric_result,
    total_variance_term,
)


def _pt(expiration, k, iv, option_type="PUT", strike=100.0, liquid=True):
    return TermQuotePoint(expiration=expiration, strike=strike, log_moneyness=k, option_type=option_type, implied_volatility=iv, liquid=liquid)


class AllStrikeMeanTests(unittest.TestCase):
    def test_averages_every_listed_point_regardless_of_coverage(self):
        near = [_pt("2026-10-01", -0.3, 0.30), _pt("2026-10-01", 0.0, 0.20), _pt("2026-10-01", 0.3, 0.25)]
        far = [_pt("2026-11-01", 0.0, 0.22)]  # far expiry only has an ATM quote
        result = all_strike_mean_term(near, far, near_dte=17, far_dte=48)
        self.assertAlmostEqual(result.near_iv, (0.30 + 0.20 + 0.25) / 3)
        self.assertAlmostEqual(result.far_iv, 0.22)


class AtmRelativeTests(unittest.TestCase):
    def test_uses_only_the_nearest_to_atm_strike(self):
        near = [_pt("2026-10-01", -0.3, 0.30), _pt("2026-10-01", 0.02, 0.21), _pt("2026-10-01", 0.3, 0.25)]
        far = [_pt("2026-11-01", -0.01, 0.22), _pt("2026-11-01", 0.4, 0.28)]
        result = atm_relative_term(near, far, near_dte=17, far_dte=48)
        self.assertAlmostEqual(result.near_iv, 0.21)
        self.assertAlmostEqual(result.far_iv, 0.22)


class MatchedLogMoneynessTests(unittest.TestCase):
    def test_matches_a_target_k_within_tolerance(self):
        near = [_pt("2026-10-01", -0.25, 0.29)]
        far = [_pt("2026-11-01", -0.24, 0.24)]
        result = matched_log_moneyness_term(near, far, near_dte=17, far_dte=48, target_log_moneyness=-0.25, max_moneyness_distance=0.05)
        self.assertAlmostEqual(result.near_iv, 0.29)
        self.assertAlmostEqual(result.far_iv, 0.24)

    def test_refuses_a_point_outside_tolerance(self):
        near = [_pt("2026-10-01", -0.25, 0.29)]
        far = [_pt("2026-11-01", 0.30, 0.24)]  # far outside tolerance of -0.25
        result = matched_log_moneyness_term(near, far, near_dte=17, far_dte=48, target_log_moneyness=-0.25, max_moneyness_distance=0.05)
        self.assertIsNone(result.near_iv)
        self.assertEqual(result.missingness_note, "NO_POINT_WITHIN_MONEYNESS_TOLERANCE_AT_ONE_OR_BOTH_EXPIRATIONS")


class TotalVarianceTests(unittest.TestCase):
    def test_computes_w_equals_iv_squared_times_t(self):
        result = total_variance_term(near_iv=0.25, near_dte=30, far_iv=0.22, far_dte=60)
        expected_near = 0.25 ** 2 * (30 / 365)
        expected_far = 0.22 ** 2 * (60 / 365)
        self.assertAlmostEqual(result.total_variance_near, expected_near)
        self.assertAlmostEqual(result.total_variance_far, expected_far)
        self.assertAlmostEqual(result.slope, expected_far - expected_near)

    def test_unknown_inputs_refuse_to_compute(self):
        result = total_variance_term(near_iv=None, near_dte=30, far_iv=0.22, far_dte=60)
        self.assertIsNone(result.total_variance_near)
        self.assertEqual(result.missingness_note, "IV_OR_DTE_UNKNOWN")


class ForwardVarianceTests(unittest.TestCase):
    def test_forward_vol_recovers_a_flat_term_structure_correctly(self):
        # Flat IV term structure: forward vol between near and far should equal the flat IV.
        result = forward_variance_term(near_iv=0.25, near_dte=30, far_iv=0.25, far_dte=90)
        self.assertAlmostEqual(result, 0.25, places=6)

    def test_calendar_arbitrage_case_refuses_a_negative_sqrt(self):
        # far total variance < near total variance -- an arbitrage condition.
        result = forward_variance_term(near_iv=0.40, near_dte=30, far_iv=0.10, far_dte=60)
        self.assertIsNone(result)

    def test_far_not_after_near_refuses(self):
        result = forward_variance_term(near_iv=0.25, near_dte=60, far_iv=0.25, far_dte=30)
        self.assertIsNone(result)


class MethodComparisonTests(unittest.TestCase):
    def test_divergence_detection_between_all_strike_and_matched_moneyness(self):
        near = [_pt("2026-10-01", -0.3, 0.35), _pt("2026-10-01", 0.0, 0.20), _pt("2026-10-01", 0.3, 0.20)]
        far = [_pt("2026-11-01", 0.0, 0.21)]
        all_strike = all_strike_mean_term(near, far, near_dte=17, far_dte=48)
        matched = matched_log_moneyness_term(near, far, near_dte=17, far_dte=48, target_log_moneyness=0.0, max_moneyness_distance=0.05)
        comparison = TermMethodComparison({TermMethod.ALL_STRIKE_MEAN: all_strike, TermMethod.MATCHED_LOG_MONEYNESS: matched})
        # all-strike near mean = (0.35+0.20+0.20)/3 = 0.2500 vs matched near = 0.20 -> different slopes
        diverges = comparison.all_strike_diverges_from_matched(tolerance=0.01)
        self.assertTrue(diverges)

    def test_no_divergence_when_a_method_is_unknown(self):
        comparison = TermMethodComparison({TermMethod.ALL_STRIKE_MEAN: all_strike_mean_term([], [], None, None)})
        self.assertIsNone(comparison.all_strike_diverges_from_matched(tolerance=0.01))


class ProviderTermMetricTests(unittest.TestCase):
    def test_known_slope_produces_a_ready_result(self):
        result = provider_term_metric_result(0.015, "SPY", "2026-09-14T00:00:00Z")
        self.assertEqual(result.method, TermMethod.PROVIDER_TERM_METRIC)
        self.assertAlmostEqual(result.slope, 0.015)
        self.assertIsNone(result.near_iv)  # provider gives only the aggregate slope, never fabricated near/far IV

    def test_unknown_slope_carries_an_explicit_missingness_note(self):
        result = provider_term_metric_result(None, "SPY", "2026-09-14T00:00:00Z")
        self.assertIsNone(result.slope)
        self.assertEqual(result.missingness_note, "PROVIDER_TERM_SLOPE_UNKNOWN")


if __name__ == "__main__":
    unittest.main()
