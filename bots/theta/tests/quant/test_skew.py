"""Tests for bots/theta/quant/features/skew.py (work package 05)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState, FeatureTruthClass  # noqa: E402
from features.skew import SkewWingObservation, risk_reversal_skew  # noqa: E402

EXP = "2026-10-16"


def _wing(option_type: str, delta: float, iv: float, expiration: str = EXP) -> SkewWingObservation:
    return SkewWingObservation(option_type=option_type, delta_magnitude=delta, iv=iv, expiration_date=expiration)


class TestRiskReversalSkew(unittest.TestCase):
    def test_normal_put_skew_is_negative(self):
        # Puts more expensive than calls at the same delta -- the common
        # equity/ETF "put skew" (crash-protection premium).
        observations = [_wing("PUT", 0.25, 0.30), _wing("CALL", 0.25, 0.20)]
        result = risk_reversal_skew(observations)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertLess(result.value, 0.0)
        self.assertAlmostEqual(result.value, -0.10, places=9)

    def test_reverse_skew_is_positive(self):
        observations = [_wing("PUT", 0.25, 0.18), _wing("CALL", 0.25, 0.28)]
        result = risk_reversal_skew(observations)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertGreater(result.value, 0.0)

    def test_missing_wing_is_insufficient_coverage_never_a_fabricated_value(self):
        observations = [_wing("PUT", 0.25, 0.30)]  # no call wing at all
        result = risk_reversal_skew(observations)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)
        self.assertIsNone(result.value)
        self.assertIn("CALL", result.reason_codes[0])

    def test_insufficient_contracts_below_minimum(self):
        observations = [_wing("PUT", 0.25, 0.30), _wing("CALL", 0.25, 0.20)]
        result = risk_reversal_skew(observations, min_contracts_per_wing=2)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_stale_contracts_excluded_upstream_produce_insufficient_coverage(self):
        # Staleness is enforced upstream by iv.py's iv_feature_result --
        # a caller that filters out stale contracts before calling this
        # function correctly gets INSUFFICIENT_COVERAGE, not a fabricated
        # skew computed from a stale IV.
        observations = [_wing("PUT", 0.25, 0.30)]  # the call wing was excluded as stale by the caller
        result = risk_reversal_skew(observations)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_mixed_expiry_rejection(self):
        observations = [_wing("PUT", 0.25, 0.30, expiration="2026-10-16"),
                         _wing("CALL", 0.25, 0.20, expiration="2026-11-20")]
        result = risk_reversal_skew(observations)
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIsNone(result.value)

    def test_no_observations_is_insufficient_coverage(self):
        result = risk_reversal_skew([])
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_determinism(self):
        observations = [_wing("PUT", 0.25, 0.30), _wing("CALL", 0.25, 0.20)]
        first = risk_reversal_skew(observations)
        second = risk_reversal_skew(observations)
        self.assertEqual(first.value, second.value)
        self.assertEqual(first.content_hash(), second.content_hash())

    def test_truth_class_is_derived_from_observed(self):
        observations = [_wing("PUT", 0.25, 0.30), _wing("CALL", 0.25, 0.20)]
        result = risk_reversal_skew(observations)
        self.assertEqual(result.truth_class, FeatureTruthClass.DERIVED_FROM_OBSERVED)


if __name__ == "__main__":
    unittest.main()
