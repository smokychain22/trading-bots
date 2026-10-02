"""Phase 2 offline tests: THETA-A/C/Q router applicability by lifecycle, and THETA-H unknown handling.
Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.strategy_router import (  # noqa: E402
    LifecycleState, MarketContext, PortfolioContext, RouterPolicy, StrategyFamily, eligible_families, route_strategies,
)
from models.theta_h_baseline import ThetaHCandidateInputs, ThetaHPolicy, ThetaHPolicyV0  # noqa: E402

POLICY = RouterPolicy("P2-ROUTER", 0.5, 0.8, False)
MARKET = MarketContext(0.9, True, False, True)


def _route(lifecycle, shares, open_option=False, imminent=False):
    return eligible_families(route_strategies(
        POLICY, PortfolioContext(lifecycle, shares, open_option, imminent), MARKET))


class RouterLifecycleApplicability(unittest.TestCase):
    def test_flat_cash_account_only_q_h_are_applicable(self):
        fams = _route(LifecycleState.CASH_AVAILABLE, 0.0)
        self.assertIn(StrategyFamily.THETA_Q, fams)
        self.assertNotIn(StrategyFamily.THETA_A, fams)
        self.assertNotIn(StrategyFamily.THETA_C, fams)
        self.assertNotIn(StrategyFamily.THETA_R, fams)

    def test_stock_held_label_without_confirmed_shares_is_not_inventory(self):
        for lifecycle in (LifecycleState.STOCK_HELD, LifecycleState.RECOVERY):
            fams = _route(lifecycle, 0.0)
            self.assertNotIn(StrategyFamily.THETA_A, fams, lifecycle)
            self.assertNotIn(StrategyFamily.THETA_C, fams, lifecycle)
            self.assertNotIn(StrategyFamily.THETA_Q, fams, lifecycle)

    def test_confirmed_stock_makes_a_and_c_applicable_and_never_q(self):
        for shares in (1.0, 99.0, 100.0, 250.0):
            fams = _route(LifecycleState.STOCK_HELD, shares)
            self.assertIn(StrategyFamily.THETA_A, fams)
            self.assertIn(StrategyFamily.THETA_C, fams)
            self.assertNotIn(StrategyFamily.THETA_Q, fams, "Q is a fresh-entry family; stock inventory excludes it")

    def test_assignment_risk_makes_a_applicable_without_stock_but_never_c(self):
        fams = _route(LifecycleState.ASSIGNMENT_RISK, 0.0, open_option=True)
        self.assertIn(StrategyFamily.THETA_A, fams)
        self.assertNotIn(StrategyFamily.THETA_C, fams, "no covered calls before assignment actually happens")

    def test_cc_open_state_keeps_r_and_c_but_not_q(self):
        fams = _route(LifecycleState.CC_OPEN, 100.0, open_option=True)
        self.assertIn(StrategyFamily.THETA_R, fams)
        self.assertIn(StrategyFamily.THETA_C, fams)
        self.assertNotIn(StrategyFamily.THETA_Q, fams)

    def test_unknown_stock_or_lifecycle_excludes_everything_with_data_reason(self):
        for portfolio in (PortfolioContext(LifecycleState.STOCK_HELD, None, False, False),
                          PortfolioContext(LifecycleState.UNKNOWN, 100.0, False, False)):
            results = route_strategies(POLICY, portfolio, MARKET)
            self.assertEqual(eligible_families(results), [])
            self.assertEqual(len(results), 6)

    def test_negative_or_nan_shares_are_never_inventory(self):
        for shares in (-100.0, float("nan")):
            fams = _route(LifecycleState.STOCK_HELD, shares)
            self.assertNotIn(StrategyFamily.THETA_C, fams)
            self.assertNotIn(StrategyFamily.THETA_A, fams)


def _h_policy():
    return ThetaHPolicy(ThetaHPolicyV0(
        policy_version="P2-H", min_dte=2, max_dte=5, max_spread_pct=0.2, min_quote_freshness_seconds=30,
        min_open_interest=100, min_volume=50, earnings_exclusion_days=5, ownership_acceptability_floor=0.5,
        max_gamma_exposure=0.05, max_overnight_gap_tolerance_pct=0.05, risk_budget_qty_cap=3,
        collateral_qty_cap=3, concentration_qty_cap=3))


def _h(**overrides):
    base = dict(underlying_symbol="AAPL", strike=190.0, multiplier=100.0, entry_premium_per_share=0.8, dte=4,
                spot_price=200.0, spread_pct=0.1, quote_age_seconds=5.0, open_interest=500, volume=300, gamma=0.01,
                overnight_gap_history_pct=0.01, ownership_acceptability=0.9, earnings_distance_days=40,
                broker_allowed_qty=2, contract_is_standard=True)
    base.update(overrides)
    return ThetaHCandidateInputs(**base)


class ThetaHUnknownHandling(unittest.TestCase):
    def test_clean_candidate_is_sized(self):
        ev = _h_policy().evaluate(_h())
        self.assertFalse(ev.hard_veto)
        self.assertEqual(ev.quantity, 2)

    def test_unknown_short_dte_hazards_are_vetoed_not_assumed_safe(self):
        for field, code in (("gamma", "GAMMA_UNKNOWN"), ("overnight_gap_history_pct", "OVERNIGHT_GAP_HISTORY_UNKNOWN"),
                            ("earnings_distance_days", "EARNINGS_DISTANCE_UNKNOWN")):
            ev = _h_policy().evaluate(_h(**{field: None}))
            self.assertTrue(ev.hard_veto, field)
            self.assertEqual(ev.quantity, 0, field)
            self.assertIn(code, [r.code for r in ev.reasons])

    def test_unknown_quote_age_spread_and_liquidity_are_vetoed(self):
        for field in ("spread_pct", "quote_age_seconds", "open_interest", "volume"):
            ev = _h_policy().evaluate(_h(**{field: None}))
            self.assertTrue(ev.hard_veto, field)
            self.assertEqual(ev.quantity, 0, field)

    def test_zero_broker_qty_and_unknown_ownership_size_to_zero(self):
        self.assertEqual(_h_policy().evaluate(_h(broker_allowed_qty=0)).quantity, 0)
        unknown_owner = _h_policy().evaluate(_h(ownership_acceptability=None))
        self.assertEqual(unknown_owner.quantity, 0)
        self.assertFalse(unknown_owner.hard_veto)

    def test_short_dte_window_pin_and_gap_mechanics(self):
        policy = _h_policy()
        for dte, vetoed in ((1, True), (2, False), (5, False), (6, True)):
            self.assertEqual(policy.evaluate(_h(dte=dte)).hard_veto, vetoed, dte)
        atm = policy.evaluate(_h(spot_price=190.0))
        self.assertEqual(atm.diagnostics.distance_to_strike_pct, 0.0)
        self.assertEqual(atm.diagnostics.assignment_probability_proxy, 1.0)
        self.assertTrue(atm.diagnostics.recovery_requirement_expected)
        gap = policy.evaluate(_h(overnight_gap_history_pct=0.03))
        self.assertTrue(gap.diagnostics.overnight_gap_risk_flag)
        self.assertTrue(policy.evaluate(_h(overnight_gap_history_pct=0.06)).hard_veto)
        self.assertTrue(policy.evaluate(_h(gamma=0.06)).hard_veto)
        self.assertTrue(policy.evaluate(_h(earnings_distance_days=5)).hard_veto)
        self.assertTrue(policy.evaluate(_h(contract_is_standard=False)).hard_veto)

    def test_economics_use_entry_premium_and_full_collateral(self):
        e = _h_policy().evaluate(_h()).economics
        self.assertAlmostEqual(e.max_profit, 80.0)
        self.assertAlmostEqual(e.break_even_price, 189.2)
        self.assertAlmostEqual(e.secured_collateral_per_contract, 19000.0)


if __name__ == "__main__":
    unittest.main()
