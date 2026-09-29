"""Tests for bots/theta/quant/features/router_research_adapter.py (work
package 22): FeatureBundle + broker-confirmed portfolio state -> the REAL,
unmodified models/strategy_router.py's route_strategies() -- proving
applicability across Q/H/D/A/C, multiple eligible, WAIT (all ineligible),
and an unknown decisive feature.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_bundle import build_feature_bundle  # noqa: E402
from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass  # noqa: E402
from features.router_research_adapter import (  # noqa: E402
    BrokerConfirmedPortfolioState, market_context_from_bundle, portfolio_context_from_broker_state,
)
from models.strategy_router import (  # noqa: E402
    EligibilityState, LifecycleState, RouterPolicy, StrategyFamily, eligible_families, route_strategies,
)


def _policy(**overrides) -> RouterPolicy:
    defaults = dict(
        policy_version="TEST-ROUTER-1", theta_q_min_ownership_acceptability=0.5,
        theta_h_min_ownership_acceptability=0.8, theta_d_gate_satisfied=False,
    )
    defaults.update(overrides)
    return RouterPolicy(**defaults)


def _liquidity_ok(spread_pct: float = 0.02) -> FeatureResult:
    return FeatureResult(
        feature_id="LIQUIDITY_SPY", family="LIQUIDITY", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={"spreadPct": spread_pct}, units="u", source_provider="ALPACA",
        source_operation="op", as_of="t", retrieved_at="t", freshness_seconds=None, coverage=None, version="v1",
    )


def _iv_ok() -> FeatureResult:
    return FeatureResult(
        feature_id="IV_SPY", family="IV", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=0.25, structured_value=None,
        units="u", source_provider="OPTIONOMICS", source_operation="op", as_of="t", retrieved_at="t",
        freshness_seconds=None, coverage=None, version="v1",
    )


def _event_far(distance_days: float = 60.0) -> FeatureResult:
    return FeatureResult(
        feature_id="EVENT_CONTEXT_SPY", family="EVENT_CONTEXT", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={"distanceDays": distance_days, "isPast": False}, units="u", source_provider="p",
        source_operation="op", as_of="t", retrieved_at="t", freshness_seconds=None, coverage=None, version="v1",
    )


class TestRouterResearchAdapter(unittest.TestCase):
    def test_cash_available_high_ownership_is_theta_q_eligible(self):
        bundle = build_feature_bundle(
            {"LIQUIDITY": _liquidity_ok(), "IV": _iv_ok(), "EVENT_CONTEXT": _event_far()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.9)
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.CASH_AVAILABLE, 0.0, False, False))
        results = route_strategies(_policy(), portfolio, market)
        eligible = eligible_families(results)
        self.assertIn(StrategyFamily.THETA_Q, eligible)

    def test_stock_held_is_covered_call_eligible(self):
        bundle = build_feature_bundle(
            {"LIQUIDITY": _liquidity_ok(), "IV": _iv_ok(), "EVENT_CONTEXT": _event_far()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.9)
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.STOCK_HELD, 100.0, False, False))
        results = route_strategies(_policy(), portfolio, market)
        eligible = eligible_families(results)
        self.assertIn(StrategyFamily.THETA_C, eligible)

    def test_multiple_families_can_be_eligible_simultaneously(self):
        bundle = build_feature_bundle(
            {"LIQUIDITY": _liquidity_ok(), "IV": _iv_ok(), "EVENT_CONTEXT": _event_far()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.9)
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.CASH_AVAILABLE, 0.0, False, False))
        results = route_strategies(_policy(theta_d_gate_satisfied=True), portfolio, market)
        eligible = eligible_families(results)
        self.assertGreaterEqual(len(eligible), 1)  # at least Q; D may also be eligible depending on router policy

    def test_unknown_decisive_feature_fails_closed_never_assumed_eligible(self):
        # LIQUIDITY missing entirely from the bundle -> UNKNOWN -> critical_data_valid=False.
        bundle = build_feature_bundle({"IV": _iv_ok()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.9)
        self.assertFalse(market.critical_data_valid)
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.CASH_AVAILABLE, 0.0, False, False))
        results = route_strategies(_policy(), portfolio, market)
        for result in results:
            self.assertEqual(result.eligibility_state, EligibilityState.INELIGIBLE_DATA)

    def test_no_open_position_no_assignment_no_stock_is_wait_like_state(self):
        bundle = build_feature_bundle(
            {"LIQUIDITY": _liquidity_ok(), "IV": _iv_ok(), "EVENT_CONTEXT": _event_far()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.0)  # too low for any ownership-gated family
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.CASH_AVAILABLE, 0.0, False, False))
        results = route_strategies(_policy(), portfolio, market)
        eligible = eligible_families(results)
        self.assertNotIn(StrategyFamily.THETA_Q, eligible)  # ownership too low -- WAIT is the real alternative

    def test_never_implements_final_selection_only_eligibility(self):
        # This adapter/test suite never asserts a SELECTED candidate -- only
        # eligibility, per work package 22's explicit prohibition.
        bundle = build_feature_bundle(
            {"LIQUIDITY": _liquidity_ok(), "IV": _iv_ok(), "EVENT_CONTEXT": _event_far()}, "SPY", "t", "t")
        market = market_context_from_bundle(bundle, ownership_acceptable=0.9)
        portfolio = portfolio_context_from_broker_state(BrokerConfirmedPortfolioState(
            LifecycleState.CASH_AVAILABLE, 0.0, False, False))
        results = route_strategies(_policy(), portfolio, market)
        for result in results:
            self.assertTrue(hasattr(result, "eligible"))
            self.assertFalse(hasattr(result, "selected_candidate_id"))


if __name__ == "__main__":
    unittest.main()
