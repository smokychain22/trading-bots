"""Tests for bots/theta/quant/research/strategy_routing_shadow.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.strategy_router import StrategyFamily  # noqa: E402
from research.strategy_routing_shadow import (  # noqa: E402
    GateRegretRecord,
    GateRegretSummary,
    MissedStrategyOpportunity,
    RouteRegret,
    StrategySelectionRegret,
)


class GateRegretRecordTests(unittest.TestCase):
    def test_false_reject_is_none_when_counterfactual_ev_unknown(self):
        record = GateRegretRecord("SPREAD_TOO_WIDE", "cand-1", counterfactual_ev=None, counterfactual_tail_risk=None)
        self.assertIsNone(record.false_reject)

    def test_false_reject_is_true_when_counterfactual_ev_positive(self):
        record = GateRegretRecord("SPREAD_TOO_WIDE", "cand-1", counterfactual_ev=25.0, counterfactual_tail_risk=5.0)
        self.assertTrue(record.false_reject)

    def test_false_reject_is_false_when_counterfactual_ev_non_positive(self):
        record = GateRegretRecord("SPREAD_TOO_WIDE", "cand-1", counterfactual_ev=-10.0, counterfactual_tail_risk=5.0)
        self.assertFalse(record.false_reject)


class GateRegretSummaryTests(unittest.TestCase):
    def test_aggregates_false_rejects_by_gate(self):
        summary = GateRegretSummary(records=[
            GateRegretRecord("OWNERSHIP_UNACCEPTABLE", "c1", 10.0, 1.0),
            GateRegretRecord("OWNERSHIP_UNACCEPTABLE", "c2", 20.0, 1.0),
            GateRegretRecord("SPREAD_TOO_WIDE", "c3", -5.0, 1.0),
        ])
        false_rejects = summary.false_reject_count_by_gate()
        self.assertEqual(false_rejects["OWNERSHIP_UNACCEPTABLE"], 2)
        self.assertNotIn("SPREAD_TOO_WIDE", false_rejects)

    def test_aggregates_correctly_rejected_by_gate(self):
        summary = GateRegretSummary(records=[GateRegretRecord("SPREAD_TOO_WIDE", "c1", -5.0, 1.0)])
        correct = summary.correctly_rejected_count_by_gate()
        self.assertEqual(correct["SPREAD_TOO_WIDE"], 1)

    def test_aggregates_unknown_by_gate(self):
        summary = GateRegretSummary(records=[GateRegretRecord("OWNERSHIP_UNACCEPTABLE", "c1", None, None)])
        unknown = summary.unknown_count_by_gate()
        self.assertEqual(unknown["OWNERSHIP_UNACCEPTABLE"], 1)


class ShadowRecordShapeTests(unittest.TestCase):
    def test_strategy_selection_regret_defaults_to_blocked_on_data(self):
        regret = StrategySelectionRegret("2024-01-01T00:00:00", StrategyFamily.THETA_Q, StrategyFamily.THETA_H, None)
        self.assertEqual(regret.status, "BLOCKED_ON_DATA")
        self.assertIsNone(regret.regret)

    def test_route_regret_defaults_to_blocked_on_data(self):
        regret = RouteRegret("2024-01-01T00:00:00", "OWNERSHIP_UNACCEPTABLE", StrategyFamily.THETA_H, None)
        self.assertEqual(regret.status, "BLOCKED_ON_DATA")

    def test_missed_strategy_opportunity_defaults_to_blocked_on_data(self):
        missed = MissedStrategyOpportunity("2024-01-01T00:00:00", StrategyFamily.THETA_D, "GATE_NOT_SATISFIED", None)
        self.assertEqual(missed.status, "BLOCKED_ON_DATA")


if __name__ == "__main__":
    unittest.main()
