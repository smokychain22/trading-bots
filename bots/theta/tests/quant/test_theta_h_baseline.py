"""Tests for bots/theta/quant/models/theta_h_baseline.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.theta_h_baseline import (  # noqa: E402
    ThetaHCandidateInputs,
    ThetaHPolicy,
    ThetaHPolicyV0,
)


def _policy(**overrides) -> ThetaHPolicyV0:
    defaults = dict(
        policy_version="TEST-THETAH-1",
        min_dte=2,
        max_dte=5,
        max_spread_pct=0.05,
        min_quote_freshness_seconds=3.0,
        min_open_interest=50,
        min_volume=10,
        earnings_exclusion_days=3,
        ownership_acceptability_floor=0.5,
        max_gamma_exposure=0.5,
        max_overnight_gap_tolerance_pct=0.05,
        risk_budget_qty_cap=5,
        collateral_qty_cap=3,
        concentration_qty_cap=10,
    )
    defaults.update(overrides)
    return ThetaHPolicyV0(**defaults)


def _candidate(**overrides) -> ThetaHCandidateInputs:
    defaults = dict(
        underlying_symbol="SYN",
        strike=50.0,
        multiplier=100.0,
        entry_premium_per_share=0.60,
        dte=3,
        spot_price=50.0,
        spread_pct=0.02,
        quote_age_seconds=1.0,
        open_interest=200,
        volume=50,
        gamma=0.1,
        overnight_gap_history_pct=0.01,
        ownership_acceptability=0.8,
        earnings_distance_days=30,
        broker_allowed_qty=4,
        contract_is_standard=True,
    )
    defaults.update(overrides)
    return ThetaHCandidateInputs(**defaults)


class HardVetoTests(unittest.TestCase):
    def setUp(self):
        self.policy = ThetaHPolicy(_policy())

    def test_clean_candidate_passes(self):
        result = self.policy.evaluate(_candidate())
        self.assertFalse(result.hard_veto)

    def test_dte_outside_window_is_vetoed(self):
        result = self.policy.evaluate(_candidate(dte=20))
        self.assertTrue(result.hard_veto)
        self.assertIn("DTE_OUTSIDE_HOLD_STRIKE_WINDOW", [r.code for r in result.reasons])

    def test_gamma_over_ceiling_is_vetoed(self):
        result = self.policy.evaluate(_candidate(gamma=0.9))
        self.assertTrue(result.hard_veto)
        self.assertIn("GAMMA_EXPOSURE_TOO_HIGH", [r.code for r in result.reasons])

    def test_overnight_gap_history_over_tolerance_is_vetoed(self):
        result = self.policy.evaluate(_candidate(overnight_gap_history_pct=0.10))
        self.assertTrue(result.hard_veto)
        self.assertIn("OVERNIGHT_GAP_HISTORY_TOO_HIGH", [r.code for r in result.reasons])


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.policy = ThetaHPolicy(_policy())

    def test_atm_candidate_has_zero_distance_and_high_assignment_proxy(self):
        result = self.policy.evaluate(_candidate(spot_price=50.0, strike=50.0))
        self.assertAlmostEqual(result.diagnostics.distance_to_strike_pct, 0.0, places=10)
        self.assertAlmostEqual(result.diagnostics.assignment_probability_proxy, 1.0, places=10)
        self.assertTrue(result.diagnostics.recovery_requirement_expected)

    def test_far_otm_candidate_has_low_assignment_proxy(self):
        # spot well above strike -> put far OTM -> low assignment likelihood
        result = self.policy.evaluate(_candidate(spot_price=60.0, strike=50.0))
        self.assertAlmostEqual(result.diagnostics.distance_to_strike_pct, 0.20, places=10)
        self.assertLess(result.diagnostics.assignment_probability_proxy, 0.1)
        self.assertFalse(result.diagnostics.recovery_requirement_expected)

    def test_overnight_gap_risk_flag_below_half_tolerance_is_false(self):
        result = self.policy.evaluate(_candidate(overnight_gap_history_pct=0.01))
        self.assertFalse(result.diagnostics.overnight_gap_risk_flag)

    def test_overnight_gap_risk_flag_above_half_tolerance_is_true(self):
        # tolerance=0.05, half=0.025 -- 0.03 exceeds the flag threshold but
        # not the hard veto ceiling itself
        result = self.policy.evaluate(_candidate(overnight_gap_history_pct=0.03))
        self.assertFalse(result.hard_veto)
        self.assertTrue(result.diagnostics.overnight_gap_risk_flag)


class EconomicsAndSizingTests(unittest.TestCase):
    def setUp(self):
        self.policy = ThetaHPolicy(_policy())

    def test_economics_hand_computed(self):
        result = self.policy.evaluate(_candidate(strike=50.0, multiplier=100.0, entry_premium_per_share=0.60))
        self.assertAlmostEqual(result.economics.max_profit, 60.0, places=10)
        self.assertAlmostEqual(result.economics.break_even_price, 49.40, places=10)
        self.assertAlmostEqual(result.economics.secured_collateral_per_contract, 5000.0, places=10)

    def test_quantity_respects_caps(self):
        result = self.policy.evaluate(_candidate(broker_allowed_qty=4))
        self.assertEqual(result.quantity, 3)  # min(5, 3, 10, 4)

    def test_below_floor_ownership_zeroes_quantity_without_hard_veto(self):
        result = self.policy.evaluate(_candidate(ownership_acceptability=0.1))
        self.assertFalse(result.hard_veto)
        self.assertEqual(result.quantity, 0)

    def test_no_wr_field_exists_anywhere_in_the_output(self):
        result = self.policy.evaluate(_candidate())
        # Structural guard: this module must never claim a win rate.
        for obj in (result, result.diagnostics, result.economics):
            if obj is not None:
                self.assertFalse(any("wr" in f.lower() or "win_rate" in f.lower() for f in vars(obj)))


if __name__ == "__main__":
    unittest.main()
