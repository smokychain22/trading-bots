"""Tests for bots/theta/quant/models/pareto_frontier.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.pareto_frontier import (  # noqa: E402
    CandidateEconomics,
    compute_pareto_frontier,
    dominated_by,
)


def _candidate(candidate_id: str, **overrides) -> CandidateEconomics:
    defaults = dict(
        candidate_id=candidate_id,
        gross_credit=100.0,
        ev_net=50.0,
        calibrated_p_win=0.7,
        break_even_wr=0.6,
        edge_buffer=0.1,
        expected_tail_loss=200.0,
        assignment_probability=0.2,
        severe_drawdown_probability=0.05,
        capital_requirement=5000.0,
        capital_days=1500.0,
        return_per_capital_day=0.002,
        liquidity_spread_pct=0.02,
        fill_probability=0.9,
        expected_slippage=0.01,
        model_uncertainty=0.1,
    )
    defaults.update(overrides)
    return CandidateEconomics(**defaults)


class StrictDominanceTests(unittest.TestCase):
    def test_a_candidate_better_on_every_dimension_dominates(self):
        better = _candidate("BETTER", ev_net=100.0, expected_tail_loss=50.0)
        worse = _candidate("WORSE", ev_net=50.0, expected_tail_loss=200.0)
        survivors = compute_pareto_frontier([better, worse])
        self.assertEqual({c.candidate_id for c in survivors}, {"BETTER"})

    def test_identical_candidates_do_not_dominate_each_other(self):
        a = _candidate("A")
        b = _candidate("B")
        survivors = compute_pareto_frontier([a, b])
        self.assertEqual({c.candidate_id for c in survivors}, {"A", "B"})


class TradeoffTests(unittest.TestCase):
    def test_a_genuine_tradeoff_keeps_both_candidates(self):
        # A has better EV but worse tail risk than B -- neither dominates.
        higher_ev_worse_tail = _candidate("HIGH_EV", ev_net=200.0, expected_tail_loss=500.0)
        lower_ev_better_tail = _candidate("LOW_TAIL", ev_net=50.0, expected_tail_loss=50.0)
        survivors = compute_pareto_frontier([higher_ev_worse_tail, lower_ev_better_tail])
        self.assertEqual({c.candidate_id for c in survivors}, {"HIGH_EV", "LOW_TAIL"})

    def test_three_way_mixed_tradeoffs_retain_all_nondominated(self):
        a = _candidate("A", ev_net=100.0, capital_requirement=10000.0)  # high EV, high capital
        b = _candidate("B", ev_net=50.0, capital_requirement=2000.0)  # low EV, low capital
        c = _candidate("C", ev_net=10.0, capital_requirement=9000.0)  # dominated by both A and B
        survivors = compute_pareto_frontier([a, b, c])
        self.assertEqual({s.candidate_id for s in survivors}, {"A", "B"})


class UnknownFieldTests(unittest.TestCase):
    def test_unknown_dimension_never_counts_toward_dominance_in_either_direction(self):
        # A has unknown tail loss; B has known tail loss. Neither can claim
        # dominance via that dimension -- it must be excluded, not treated
        # as favorable or unfavorable for either side.
        a = _candidate("A", ev_net=100.0, expected_tail_loss=None)
        b = _candidate("B", ev_net=50.0, expected_tail_loss=100.0)
        survivors = compute_pareto_frontier([a, b])
        # A is still strictly better on ev_net (the only comparable
        # dimension), so A does dominate B here -- this asserts the
        # comparable field still works, while the None field contributed
        # nothing either way.
        self.assertEqual({s.candidate_id for s in survivors}, {"A"})

    def test_all_dimensions_unknown_means_no_dominance_claim_possible(self):
        a = _candidate("A", **{field: None for field in [
            "ev_net", "edge_buffer", "return_per_capital_day", "fill_probability",
            "expected_tail_loss", "assignment_probability", "severe_drawdown_probability",
            "capital_requirement", "capital_days", "liquidity_spread_pct",
            "expected_slippage", "model_uncertainty",
        ]})
        b = _candidate("B")
        survivors = compute_pareto_frontier([a, b])
        self.assertEqual({s.candidate_id for s in survivors}, {"A", "B"})


class DominatedByDiagnosticTests(unittest.TestCase):
    def test_dominated_by_lists_the_dominating_candidates(self):
        better = _candidate("BETTER", ev_net=100.0)
        worse = _candidate("WORSE", ev_net=50.0)
        self.assertEqual(dominated_by([better, worse], "WORSE"), ["BETTER"])
        self.assertEqual(dominated_by([better, worse], "BETTER"), [])

    def test_dominated_by_raises_on_unknown_candidate_id(self):
        with self.assertRaises(ValueError):
            dominated_by([_candidate("A")], "NOT_PRESENT")


class SingleCandidateTests(unittest.TestCase):
    def test_a_single_candidate_always_survives(self):
        survivors = compute_pareto_frontier([_candidate("ONLY")])
        self.assertEqual(len(survivors), 1)

    def test_empty_input_returns_empty_output(self):
        self.assertEqual(compute_pareto_frontier([]), [])


if __name__ == "__main__":
    unittest.main()
