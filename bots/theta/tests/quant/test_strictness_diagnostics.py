"""Tests for bots/theta/quant/research/strictness_diagnostics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.strictness_diagnostics import (  # noqa: E402
    CandidateFunnel,
    RejectionBreakdown,
    funnel_ratios,
    is_funnel_internally_consistent,
)


def _funnel(**overrides):
    defaults = dict(
        universe_count=50, contracts_enumerated=2000, mechanically_invalid_count=100,
        hard_veto_count=800, soft_rejected_count=1000, ranked_count=100,
        positive_ev_count=None, risk_feasible_count=20, selected_count=2, wait_count=0,
    )
    defaults.update(overrides)
    return CandidateFunnel(**defaults)


class FunnelRatioTests(unittest.TestCase):
    def test_hard_veto_rate_computed_normally(self):
        ratios = funnel_ratios(_funnel())
        self.assertAlmostEqual(ratios.hard_veto_rate, 800 / 2000)

    def test_hard_veto_rate_is_none_when_nothing_was_enumerated(self):
        ratios = funnel_ratios(_funnel(contracts_enumerated=0, mechanically_invalid_count=0, hard_veto_count=0, soft_rejected_count=0, ranked_count=0, selected_count=0))
        self.assertIsNone(ratios.hard_veto_rate)

    def test_opportunity_capture_rate_is_none_without_empirical_positive_ev_count(self):
        # EV_MODEL_NOT_EMPIRICALLY_READY -- never fabricate this ratio.
        ratios = funnel_ratios(_funnel(positive_ev_count=None))
        self.assertIsNone(ratios.opportunity_capture_rate)

    def test_opportunity_capture_rate_computed_when_positive_ev_count_is_known(self):
        ratios = funnel_ratios(_funnel(positive_ev_count=10, selected_count=2))
        self.assertAlmostEqual(ratios.opportunity_capture_rate, 0.2)

    def test_selection_rate_is_none_when_nothing_was_ranked(self):
        ratios = funnel_ratios(_funnel(ranked_count=0, selected_count=0))
        self.assertIsNone(ratios.selection_rate)


class RejectionBreakdownTests(unittest.TestCase):
    def test_top_gates_returns_the_n_highest_rejection_counts_descending(self):
        breakdown = RejectionBreakdown(by_gate={
            "OPEN_INTEREST_BELOW_FLOOR": 500, "SPREAD_TOO_WIDE": 300, "OWNERSHIP_UNACCEPTABLE": 900,
        })
        top = breakdown.top_gates(2)
        self.assertEqual([name for name, _ in top], ["OWNERSHIP_UNACCEPTABLE", "OPEN_INTEREST_BELOW_FLOOR"])


class FunnelConsistencyTests(unittest.TestCase):
    def test_a_consistent_funnel_has_no_violations(self):
        self.assertEqual(is_funnel_internally_consistent(_funnel()), [])

    def test_selected_exceeding_ranked_is_flagged(self):
        violations = is_funnel_internally_consistent(_funnel(selected_count=200, ranked_count=100))
        self.assertTrue(any("ranked_count" in v for v in violations))

    def test_selected_exceeding_positive_ev_count_is_flagged(self):
        violations = is_funnel_internally_consistent(_funnel(positive_ev_count=1, selected_count=2))
        self.assertTrue(any("positive_ev_count" in v for v in violations))

    def test_hard_veto_exceeding_remaining_pool_is_flagged(self):
        violations = is_funnel_internally_consistent(_funnel(contracts_enumerated=100, mechanically_invalid_count=50, hard_veto_count=200, soft_rejected_count=0, ranked_count=0, selected_count=0))
        self.assertTrue(any("hard_veto_count" in v for v in violations))


if __name__ == "__main__":
    unittest.main()
