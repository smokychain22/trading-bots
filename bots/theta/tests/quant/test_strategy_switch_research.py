"""Tests for research/strategy_switch_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.strategy_switch_research import (  # noqa: E402
    SwitchCostComponents,
    SwitchDecision,
    evaluate_strategy_switch,
)


def _costs(**overrides):
    defaults = dict(
        origin_closing_realized_pnl=-50.0, origin_closing_execution_cost=5.0,
        new_entry_execution_cost=5.0, capital_days_forgone=10.0, theta_forgone=3.0,
    )
    defaults.update(overrides)
    return SwitchCostComponents(**defaults)


class EvaluateStrategySwitchTests(unittest.TestCase):
    def test_switch_when_net_edge_clears_the_bar(self):
        result = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=_costs(), minimum_net_edge_to_switch=10.0)
        self.assertEqual(result.decision, SwitchDecision.SWITCH)
        self.assertAlmostEqual(result.total_switch_cost, 13.0)
        self.assertAlmostEqual(result.candidate_net_edge_after_switch_cost, 37.0)

    def test_wait_when_positive_but_below_bar(self):
        result = evaluate_strategy_switch(candidate_expected_edge=20.0, costs=_costs(), minimum_net_edge_to_switch=10.0)
        self.assertEqual(result.decision, SwitchDecision.WAIT)

    def test_stay_when_net_edge_is_negative(self):
        result = evaluate_strategy_switch(candidate_expected_edge=5.0, costs=_costs(), minimum_net_edge_to_switch=10.0)
        self.assertEqual(result.decision, SwitchDecision.STAY)

    def test_missing_candidate_edge_is_unknown(self):
        result = evaluate_strategy_switch(candidate_expected_edge=None, costs=_costs(), minimum_net_edge_to_switch=10.0)
        self.assertEqual(result.decision, SwitchDecision.UNKNOWN)
        self.assertEqual(result.reason, "CANDIDATE_EDGE_UNKNOWN")

    def test_missing_cost_component_is_unknown_not_zero_filled(self):
        costs = _costs(theta_forgone=None)
        result = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=costs, minimum_net_edge_to_switch=10.0)
        self.assertEqual(result.decision, SwitchDecision.UNKNOWN)
        self.assertEqual(result.reason, "SWITCH_COST_COMPONENT_UNKNOWN")

    def test_realized_pnl_is_never_charged_against_the_switch_decision(self):
        # A large realized loss on the origin leg must not change the
        # switch decision -- it is informational/immutable only, never
        # blended into the candidate's own edge comparison (ROLL-001).
        cheap = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=_costs(origin_closing_realized_pnl=-5000.0), minimum_net_edge_to_switch=10.0)
        control = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=_costs(origin_closing_realized_pnl=-50.0), minimum_net_edge_to_switch=10.0)
        self.assertEqual(cheap.decision, control.decision)
        self.assertEqual(cheap.candidate_net_edge_after_switch_cost, control.candidate_net_edge_after_switch_cost)

    def test_capital_days_forgone_never_folded_into_the_dollar_cost(self):
        low_capital_days = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=_costs(capital_days_forgone=1.0), minimum_net_edge_to_switch=10.0)
        high_capital_days = evaluate_strategy_switch(candidate_expected_edge=50.0, costs=_costs(capital_days_forgone=1000.0), minimum_net_edge_to_switch=10.0)
        self.assertEqual(low_capital_days.total_switch_cost, high_capital_days.total_switch_cost)


if __name__ == "__main__":
    unittest.main()
