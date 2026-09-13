"""Tests for bots/theta/quant/research/strictness_diagnostics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.strictness_diagnostics import (  # noqa: E402
    AegisDisposition,
    AegisDispositionBreakdown,
    CandidateFunnel,
    NearMissCandidate,
    NearMissSummary,
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


class AegisDispositionTests(unittest.TestCase):
    def test_reduced_rate_is_none_when_nothing_was_allowed(self):
        breakdown = AegisDispositionBreakdown({AegisDisposition.BLOCKED: 5})
        self.assertIsNone(breakdown.reduced_rate())

    def test_reduced_rate_computed_over_allowed_only(self):
        breakdown = AegisDispositionBreakdown({
            AegisDisposition.ALLOWED_FULL: 3, AegisDisposition.ALLOWED_REDUCED: 1, AegisDisposition.BLOCKED: 6,
        })
        self.assertAlmostEqual(breakdown.reduced_rate(), 0.25)

    def test_block_rate_is_none_for_an_empty_breakdown(self):
        self.assertIsNone(AegisDispositionBreakdown().block_rate())

    def test_block_rate_computed_over_the_whole_total(self):
        breakdown = AegisDispositionBreakdown({AegisDisposition.ALLOWED_FULL: 1, AegisDisposition.BLOCKED: 3})
        self.assertAlmostEqual(breakdown.block_rate(), 0.75)


class NearMissTests(unittest.TestCase):
    def test_unresolved_near_miss_has_unknown_profitability(self):
        candidate = NearMissCandidate("cand-1", rank=6, rank_margin=1, reconstructed_outcome=None)
        self.assertIsNone(candidate.would_have_been_profitable)
        self.assertEqual(candidate.status, "BLOCKED_ON_DATA")

    def test_resolved_positive_outcome_is_profitable(self):
        candidate = NearMissCandidate("cand-1", rank=6, rank_margin=1, reconstructed_outcome=42.0)
        self.assertTrue(candidate.would_have_been_profitable)

    def test_summary_only_counts_resolved_near_misses(self):
        summary = NearMissSummary([
            NearMissCandidate("c1", 6, 1, reconstructed_outcome=None),
            NearMissCandidate("c2", 7, 2, reconstructed_outcome=10.0),
            NearMissCandidate("c3", 8, 3, reconstructed_outcome=-5.0),
        ])
        self.assertEqual(summary.resolved_count(), 2)
        self.assertEqual(summary.profitable_count(), 1)


if __name__ == "__main__":
    unittest.main()
