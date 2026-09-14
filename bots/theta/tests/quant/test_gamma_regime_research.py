"""Tests for bots/theta/quant/research/gamma_regime_research.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.gamma_regime_research import (  # noqa: E402
    GammaRegimeInputs,
    GammaRegimePolicyV0,
    GexSignState,
    GammaFlipProximityState,
    classify,
)

_POLICY = GammaRegimePolicyV0(policy_version="TEST-GAMMA-1", flip_proximity_pct_of_spot_ceiling=0.02)


def _inputs(**overrides):
    defaults = dict(total_gex=1_000_000.0, gamma_flip_strike=100.0, spot_price=100.0, sign_convention_verified=True)
    defaults.update(overrides)
    return GammaRegimeInputs(**defaults)


class GexSignTests(unittest.TestCase):
    def test_unknown_total_gex_yields_no_sign_state(self):
        snapshot = classify(_inputs(total_gex=None), _POLICY)
        self.assertIsNone(snapshot.gex_sign_state)

    def test_unverified_sign_convention_refuses_to_classify_even_with_a_known_value(self):
        snapshot = classify(_inputs(sign_convention_verified=False), _POLICY)
        self.assertIsNone(snapshot.gex_sign_state)
        self.assertTrue(any("CONVENTION_UNVERIFIED" in r.code for r in snapshot.reasons))

    def test_positive_reported_value_classifies_as_positive_reported(self):
        snapshot = classify(_inputs(total_gex=500.0), _POLICY)
        self.assertEqual(snapshot.gex_sign_state, GexSignState.POSITIVE_REPORTED)

    def test_negative_reported_value_classifies_as_negative_reported(self):
        snapshot = classify(_inputs(total_gex=-500.0), _POLICY)
        self.assertEqual(snapshot.gex_sign_state, GexSignState.NEGATIVE_REPORTED)

    def test_zero_is_a_legitimate_reported_value_never_treated_as_unknown(self):
        snapshot = classify(_inputs(total_gex=0.0), _POLICY)
        self.assertEqual(snapshot.gex_sign_state, GexSignState.ZERO_REPORTED)

    def test_caveat_is_always_present_regardless_of_resolution(self):
        snapshot = classify(_inputs(total_gex=None), _POLICY)
        self.assertIn("unverified", snapshot.sign_convention_caveat.lower())


class GammaFlipProximityTests(unittest.TestCase):
    def test_missing_flip_or_spot_yields_no_proximity_state(self):
        self.assertIsNone(classify(_inputs(gamma_flip_strike=None), _POLICY).flip_proximity_state)
        self.assertIsNone(classify(_inputs(spot_price=None), _POLICY).flip_proximity_state)

    def test_spot_at_flip_is_near(self):
        snapshot = classify(_inputs(spot_price=100.0, gamma_flip_strike=100.0), _POLICY)
        self.assertEqual(snapshot.flip_proximity_state, GammaFlipProximityState.NEAR)
        self.assertAlmostEqual(snapshot.flip_distance_pct_of_spot, 0.0)

    def test_spot_far_from_flip_is_far(self):
        snapshot = classify(_inputs(spot_price=100.0, gamma_flip_strike=150.0), _POLICY)
        self.assertEqual(snapshot.flip_proximity_state, GammaFlipProximityState.FAR)

    def test_exactly_at_the_ceiling_is_near_inclusive(self):
        snapshot = classify(_inputs(spot_price=100.0, gamma_flip_strike=102.0), _POLICY)  # 2% distance == ceiling
        self.assertEqual(snapshot.flip_proximity_state, GammaFlipProximityState.NEAR)

    def test_invalid_spot_price_yields_no_proximity_state(self):
        snapshot = classify(_inputs(spot_price=0.0), _POLICY)
        self.assertIsNone(snapshot.flip_proximity_state)


class ConfidenceTests(unittest.TestCase):
    def test_confidence_is_one_when_both_axes_resolve(self):
        self.assertAlmostEqual(classify(_inputs(), _POLICY).confidence, 1.0)

    def test_confidence_is_zero_when_neither_axis_resolves(self):
        snapshot = classify(_inputs(total_gex=None, gamma_flip_strike=None, spot_price=None), _POLICY)
        self.assertAlmostEqual(snapshot.confidence, 0.0)

    def test_confidence_is_half_when_only_one_axis_resolves(self):
        snapshot = classify(_inputs(gamma_flip_strike=None), _POLICY)
        self.assertAlmostEqual(snapshot.confidence, 0.5)


if __name__ == "__main__":
    unittest.main()
