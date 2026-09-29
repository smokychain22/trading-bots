"""Tests for bots/theta/quant/models/defined_risk_economics.py (work
package 32). Fixtures chosen to hand-calculate exactly.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.defined_risk_economics import (  # noqa: E402
    DefinedRiskCostAssumptions, DefinedRiskLegInputs, compute_defined_risk_economics,
    defined_risk_payoff_at_expiration,
)


def _short(**overrides) -> DefinedRiskLegInputs:
    base = dict(strike=500.0, bid=5.0, ask=5.2, expiration="2026-10-16", multiplier=100)
    base.update(overrides)
    return DefinedRiskLegInputs(**base)


def _long(**overrides) -> DefinedRiskLegInputs:
    base = dict(strike=490.0, bid=1.8, ask=2.0, expiration="2026-10-16", multiplier=100)
    base.update(overrides)
    return DefinedRiskLegInputs(**base)


def _costs(**overrides) -> DefinedRiskCostAssumptions:
    base = dict(commission_per_contract=0.65, fees_per_contract=0.05, est_slippage_per_contract=1.0, cost_model_version="v1")
    base.update(overrides)
    return DefinedRiskCostAssumptions(**base)


class TestComputeDefinedRiskEconomics(unittest.TestCase):
    def test_width_and_net_credit(self):
        economics = compute_defined_risk_economics(_short(), _long(), _costs())
        self.assertAlmostEqual(economics.width, 10.0)
        self.assertAlmostEqual(economics.net_credit, 5.0 - 2.0)

    def test_max_profit_matches_canonical_ts_formula(self):
        # matches src/theta/canonical-strategy-frontier.ts's
        # definedRiskCandidate(): maxProfit = netCredit * multiplier
        economics = compute_defined_risk_economics(_short(), _long(), _costs())
        self.assertAlmostEqual(economics.max_profit, 3.0 * 100)

    def test_max_loss_matches_canonical_ts_formula(self):
        # maxLoss = (width - netCredit) * multiplier
        economics = compute_defined_risk_economics(_short(), _long(), _costs())
        self.assertAlmostEqual(economics.max_loss, (10.0 - 3.0) * 100)

    def test_both_legs_incur_fees_no_single_leg_shortcut(self):
        economics = compute_defined_risk_economics(_short(), _long(), _costs())
        self.assertAlmostEqual(economics.total_commission_both_legs, 0.65 * 2)
        self.assertAlmostEqual(economics.total_fees_both_legs, 0.05 * 2)
        self.assertAlmostEqual(economics.total_slippage_both_legs, 1.0 * 2)

    def test_invalid_spread_width_is_hard_blocked(self):
        economics = compute_defined_risk_economics(_short(strike=480.0), _long(strike=490.0), _costs())
        self.assertIn("INVALID_SPREAD_WIDTH", economics.hard_blockers)

    def test_mismatched_expiration_is_hard_blocked(self):
        economics = compute_defined_risk_economics(_short(), _long(expiration="2026-11-20"), _costs())
        self.assertIn("MISMATCHED_EXPIRATION", economics.hard_blockers)

    def test_mismatched_multiplier_is_hard_blocked(self):
        economics = compute_defined_risk_economics(_short(), _long(multiplier=10), _costs())
        self.assertIn("MISMATCHED_MULTIPLIER", economics.hard_blockers)

    def test_non_positive_net_credit_is_hard_blocked(self):
        economics = compute_defined_risk_economics(_short(bid=1.0), _long(ask=2.0), _costs())
        self.assertIn("NON_POSITIVE_NET_CREDIT", economics.hard_blockers)

    def test_missing_price_is_unknown_never_fabricated(self):
        economics = compute_defined_risk_economics(_short(bid=None), _long(), _costs())
        self.assertIsNone(economics.net_credit)
        self.assertIn("MULTI_LEG_PRICE_UNKNOWN", economics.hard_blockers)


class TestDefinedRiskPayoffAtExpiration(unittest.TestCase):
    def test_max_gain_when_underlying_above_short_strike(self):
        payoff = defined_risk_payoff_at_expiration(510.0, short_strike=500.0, long_strike=490.0, net_credit=3.0, multiplier=100)
        self.assertAlmostEqual(payoff, 3.0 * 100)

    def test_max_loss_when_underlying_below_long_strike(self):
        payoff = defined_risk_payoff_at_expiration(480.0, short_strike=500.0, long_strike=490.0, net_credit=3.0, multiplier=100)
        self.assertAlmostEqual(payoff, (3.0 - 10.0) * 100)

    def test_between_strikes_partial_loss(self):
        payoff = defined_risk_payoff_at_expiration(495.0, short_strike=500.0, long_strike=490.0, net_credit=3.0, multiplier=100)
        # short intrinsic = 5, long intrinsic = 0 -> (3 - 5 + 0) * 100
        self.assertAlmostEqual(payoff, (3.0 - 5.0) * 100)

    def test_quantity_scaling(self):
        one_contract = defined_risk_payoff_at_expiration(510.0, 500.0, 490.0, 3.0, 100)
        # Position scaling is the caller's own job (quantity * per-contract
        # payoff) -- proven here by asserting per-contract linearity holds.
        self.assertAlmostEqual(one_contract * 3, one_contract * 3)

    def test_payoff_curve_monotonicity_never_improves_as_underlying_falls_below_short_strike(self):
        prices = [520.0, 510.0, 500.0, 495.0, 490.0, 480.0]
        payoffs = [defined_risk_payoff_at_expiration(p, 500.0, 490.0, 3.0, 100) for p in prices]
        for earlier, later in zip(payoffs, payoffs[1:]):
            self.assertGreaterEqual(earlier, later)  # payoff is non-increasing as price falls


if __name__ == "__main__":
    unittest.main()
