"""Tests for bots/theta/quant/features/term_structure.py (work package 06)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState, FeatureTruthClass  # noqa: E402
from features.term_structure import TermStructurePoint, term_structure_result  # noqa: E402


def _point(dte: int, iv: float, underlying: str = "SPY", expiration: str = None) -> TermStructurePoint:
    return TermStructurePoint(
        underlying_symbol=underlying, expiration_date=expiration or f"exp-{dte}", dte=dte, atm_iv=iv,
        provider_timestamp="2026-09-27T14:00:00Z",
    )


class TestTermStructureResult(unittest.TestCase):
    def test_contango_like_curve(self):
        points = [_point(10, 0.20), _point(30, 0.25), _point(60, 0.30)]
        result = term_structure_result(points)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["slopeState"], "CONTANGO")
        self.assertEqual(len(result.structured_value["curve"]), 3)

    def test_backwardation_like_curve(self):
        points = [_point(10, 0.35), _point(30, 0.25), _point(60, 0.20)]
        result = term_structure_result(points)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["slopeState"], "BACKWARDATION")

    def test_single_expiry_is_insufficient_coverage(self):
        result = term_structure_result([_point(30, 0.25)])
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)
        self.assertIsNone(result.structured_value)

    def test_stale_expiry_excluded_upstream_still_reaches_insufficient_coverage(self):
        # Staleness is enforced upstream by iv.py -- a caller that filters
        # a stale expiry's IV out before calling this function correctly
        # yields INSUFFICIENT_COVERAGE, not a fabricated curve using a
        # stale point.
        result = term_structure_result([_point(30, 0.25)])  # the second expiry was excluded as stale
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_bad_contract_identity_mixed_underlyings_is_invalid(self):
        points = [_point(10, 0.20, underlying="SPY"), _point(30, 0.25, underlying="QQQ")]
        result = term_structure_result(points)
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIsNone(result.structured_value)

    def test_no_points_is_insufficient_coverage(self):
        result = term_structure_result([])
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_curve_is_dte_ordered_regardless_of_input_order(self):
        points = [_point(60, 0.30), _point(10, 0.20), _point(30, 0.25)]
        result = term_structure_result(points)
        dtes = [entry["dte"] for entry in result.structured_value["curve"]]
        self.assertEqual(dtes, sorted(dtes))

    def test_truth_class_is_derived_from_observed(self):
        result = term_structure_result([_point(10, 0.20), _point(30, 0.25)])
        self.assertEqual(result.truth_class, FeatureTruthClass.DERIVED_FROM_OBSERVED)


if __name__ == "__main__":
    unittest.main()
