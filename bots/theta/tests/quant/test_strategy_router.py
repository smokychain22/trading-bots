"""Tests for bots/theta/quant/models/strategy_router.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.strategy_router import (  # noqa: E402
    EligibilityState,
    LifecycleState,
    MarketContext,
    PortfolioContext,
    RouterPolicy,
    StrategyFamily,
    eligible_families,
    route_strategies,
)


def _policy(**overrides) -> RouterPolicy:
    defaults = dict(
        policy_version="TEST-ROUTER-1",
        theta_q_min_ownership_acceptability=0.5,
        theta_h_min_ownership_acceptability=0.8,
        theta_d_gate_satisfied=False,
    )
    defaults.update(overrides)
    return RouterPolicy(**defaults)


def _portfolio(**overrides) -> PortfolioContext:
    defaults = dict(lifecycle_state=LifecycleState.CASH_AVAILABLE, stock_shares_held=0.0, open_option_exists=False, assignment_imminent=False)
    defaults.update(overrides)
    return PortfolioContext(**defaults)


def _market(**overrides) -> MarketContext:
    defaults = dict(ownership_acceptable=0.85, liquidity_acceptable=True, event_near=False, critical_data_valid=True)
    defaults.update(overrides)
    return MarketContext(**defaults)


class InvalidDataTests(unittest.TestCase):
    def test_invalid_critical_data_excludes_every_family(self):
        results = route_strategies(_policy(), _portfolio(), _market(critical_data_valid=False))
        self.assertEqual(len(results), len(StrategyFamily))
        self.assertTrue(all(not r.eligible for r in results))
        self.assertTrue(all(r.eligibility_state == EligibilityState.INELIGIBLE_DATA for r in results))


class LifecycleRoutingTests(unittest.TestCase):
    def test_cash_available_makes_theta_q_eligible_and_theta_r_ineligible(self):
        results = route_strategies(_policy(), _portfolio(lifecycle_state=LifecycleState.CASH_AVAILABLE), _market())
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_Q].eligible)
        self.assertFalse(by_family[StrategyFamily.THETA_R].eligible)

    def test_csp_open_makes_theta_r_eligible_and_theta_q_ineligible(self):
        results = route_strategies(_policy(), _portfolio(lifecycle_state=LifecycleState.CSP_OPEN), _market())
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_R].eligible)
        self.assertFalse(by_family[StrategyFamily.THETA_Q].eligible)

    def test_stock_held_makes_theta_a_and_theta_c_eligible(self):
        results = route_strategies(
            _policy(), _portfolio(lifecycle_state=LifecycleState.STOCK_HELD, stock_shares_held=100.0), _market()
        )
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_A].eligible)
        self.assertTrue(by_family[StrategyFamily.THETA_C].eligible)

    def test_no_stock_makes_theta_c_ineligible_even_during_recovery(self):
        results = route_strategies(
            _policy(), _portfolio(lifecycle_state=LifecycleState.RECOVERY, stock_shares_held=0.0), _market()
        )
        by_family = {r.strategy_family: r for r in results}
        self.assertFalse(by_family[StrategyFamily.THETA_C].eligible)
        self.assertEqual(by_family[StrategyFamily.THETA_C].eligibility_state, EligibilityState.INELIGIBLE_STRUCTURE)

    def test_assignment_imminent_flag_alone_makes_theta_a_eligible(self):
        results = route_strategies(
            _policy(), _portfolio(lifecycle_state=LifecycleState.CASH_AVAILABLE, assignment_imminent=True), _market()
        )
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_A].eligible)


class NoVotingArchitectureTests(unittest.TestCase):
    def test_theta_r_ineligibility_does_not_block_theta_q_eligibility(self):
        # The central anti-voting guarantee: one family being ineligible
        # must never suppress an unrelated family's independent eligibility.
        results = route_strategies(_policy(), _portfolio(lifecycle_state=LifecycleState.CASH_AVAILABLE), _market())
        by_family = {r.strategy_family: r for r in results}
        self.assertFalse(by_family[StrategyFamily.THETA_R].eligible)
        self.assertTrue(by_family[StrategyFamily.THETA_Q].eligible)

    def test_every_family_gets_a_result_even_when_ineligible(self):
        results = route_strategies(_policy(), _portfolio(lifecycle_state=LifecycleState.CSP_OPEN), _market())
        self.assertEqual({r.strategy_family for r in results}, set(StrategyFamily))


class ThetaHStricterBarTests(unittest.TestCase):
    def test_theta_h_ineligible_below_its_own_stricter_bar_even_if_theta_q_qualifies(self):
        results = route_strategies(
            _policy(theta_q_min_ownership_acceptability=0.5, theta_h_min_ownership_acceptability=0.9),
            _portfolio(),
            _market(ownership_acceptable=0.85),  # clears THETA-Q's 0.5 floor but not THETA-H's stricter 0.9
        )
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_Q].eligible)
        self.assertFalse(by_family[StrategyFamily.THETA_H].eligible)
        self.assertEqual(by_family[StrategyFamily.THETA_H].eligibility_state, EligibilityState.INELIGIBLE_RISK)

    def test_theta_h_ineligible_near_an_event_even_with_good_ownership(self):
        results = route_strategies(_policy(), _portfolio(), _market(event_near=True))
        by_family = {r.strategy_family: r for r in results}
        self.assertFalse(by_family[StrategyFamily.THETA_H].eligible)


class ThetaDGateTests(unittest.TestCase):
    def test_theta_d_ineligible_when_gate_not_satisfied(self):
        results = route_strategies(_policy(theta_d_gate_satisfied=False), _portfolio(), _market())
        by_family = {r.strategy_family: r for r in results}
        self.assertFalse(by_family[StrategyFamily.THETA_D].eligible)

    def test_theta_d_eligible_as_challenger_when_gate_satisfied(self):
        results = route_strategies(_policy(theta_d_gate_satisfied=True), _portfolio(), _market())
        by_family = {r.strategy_family: r for r in results}
        self.assertTrue(by_family[StrategyFamily.THETA_D].eligible)
        self.assertEqual(by_family[StrategyFamily.THETA_D].eligibility_state, EligibilityState.ELIGIBLE_CHALLENGER)


class UnknownOwnershipTests(unittest.TestCase):
    def test_unknown_ownership_excludes_theta_q_never_assumed_acceptable(self):
        results = route_strategies(_policy(), _portfolio(), _market(ownership_acceptable=None))
        by_family = {r.strategy_family: r for r in results}
        self.assertFalse(by_family[StrategyFamily.THETA_Q].eligible)
        self.assertEqual(by_family[StrategyFamily.THETA_Q].eligibility_state, EligibilityState.INELIGIBLE_DATA)


class EligibleFamiliesHelperTests(unittest.TestCase):
    def test_eligible_families_returns_only_eligible_ones(self):
        results = route_strategies(_policy(), _portfolio(lifecycle_state=LifecycleState.CASH_AVAILABLE), _market())
        families = eligible_families(results)
        self.assertIn(StrategyFamily.THETA_Q, families)
        self.assertNotIn(StrategyFamily.THETA_R, families)


if __name__ == "__main__":
    unittest.main()
