"""Tests for bots/theta/quant/research/wait_diagnostics_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.wait_diagnostics_research import (  # noqa: E402
    RejectedCandidateOutcome,
    RejectOutcomeState,
    WaitCycleFunnel,
    WaitKind,
    classify_wait,
    evaluate_false_reject,
    wait_kind_distribution,
)


def _funnel(**overrides) -> WaitCycleFunnel:
    base = dict(
        branches_applicable=3, branches_evaluated=3, candidates_enumerated=5,
        candidates_data_blocked=None, candidates_quote_blocked=None, candidates_event_blocked=None,
        candidates_liquidity_blocked=None, candidates_portfolio_blocked=None,
        candidates_soft_policy_rejected=None, neighboring_cell_passed=None,
        consecutive_wait_cycles=None, consecutive_wait_bound=None,
    )
    base.update(overrides)
    return WaitCycleFunnel(**base)


class ClassifyWaitTests(unittest.TestCase):
    def test_not_every_branch_evaluated_is_unknown_not_a_verdict(self):
        result = classify_wait(_funnel(branches_evaluated=2))
        self.assertEqual(result, WaitKind.UNKNOWN_WAIT_KIND)

    def test_zero_candidates_enumerated_is_no_opportunity(self):
        result = classify_wait(_funnel(candidates_enumerated=0))
        self.assertEqual(result, WaitKind.NO_OPPORTUNITY)

    def test_missing_enumerated_count_is_unknown(self):
        result = classify_wait(_funnel(candidates_enumerated=None))
        self.assertEqual(result, WaitKind.UNKNOWN_WAIT_KIND)

    def test_all_candidates_data_blocked_is_data_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_data_blocked=4))
        self.assertEqual(result, WaitKind.DATA_WAIT)

    def test_all_candidates_quote_blocked_is_quote_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_quote_blocked=4))
        self.assertEqual(result, WaitKind.QUOTE_WAIT)

    def test_all_candidates_event_blocked_is_event_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_event_blocked=4))
        self.assertEqual(result, WaitKind.EVENT_WAIT)

    def test_all_candidates_liquidity_blocked_is_liquidity_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_liquidity_blocked=4))
        self.assertEqual(result, WaitKind.LIQUIDITY_WAIT)

    def test_all_candidates_portfolio_blocked_is_portfolio_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_portfolio_blocked=4))
        self.assertEqual(result, WaitKind.PORTFOLIO_WAIT)

    def test_partial_data_block_does_not_force_data_wait(self):
        # Only SOME candidates were data-blocked -- the cycle isn't purely a data problem.
        result = classify_wait(_funnel(candidates_enumerated=4, candidates_data_blocked=2))
        self.assertNotEqual(result, WaitKind.DATA_WAIT)

    def test_structural_reason_takes_priority_over_overstrict_policy(self):
        # Even with a neighboring cell passing and soft rejects present, a hard
        # liquidity block covering every candidate must win the classification.
        result = classify_wait(_funnel(
            candidates_enumerated=3, candidates_liquidity_blocked=3,
            neighboring_cell_passed=True, candidates_soft_policy_rejected=2,
        ))
        self.assertEqual(result, WaitKind.LIQUIDITY_WAIT)

    def test_overstrict_policy_wait_requires_a_passing_neighbor(self):
        result = classify_wait(_funnel(
            candidates_enumerated=3, neighboring_cell_passed=True, candidates_soft_policy_rejected=2,
        ))
        self.assertEqual(result, WaitKind.OVERSTRICT_POLICY_WAIT)

    def test_soft_rejects_without_a_passing_neighbor_stay_healthy(self):
        result = classify_wait(_funnel(
            candidates_enumerated=3, neighboring_cell_passed=False, candidates_soft_policy_rejected=2,
        ))
        self.assertEqual(result, WaitKind.HEALTHY_WAIT)

    def test_paralysis_requires_exceeding_a_caller_supplied_bound(self):
        result = classify_wait(_funnel(
            candidates_enumerated=3, consecutive_wait_cycles=50, consecutive_wait_bound=20,
        ))
        self.assertEqual(result, WaitKind.POSSIBLE_LOGIC_PARALYSIS)

    def test_paralysis_never_triggers_without_a_bound(self):
        # No hardcoded default bound -- absent a caller-supplied bound, this
        # module never declares paralysis on its own judgment.
        result = classify_wait(_funnel(candidates_enumerated=3, consecutive_wait_cycles=500))
        self.assertEqual(result, WaitKind.HEALTHY_WAIT)

    def test_clean_healthy_wait(self):
        result = classify_wait(_funnel(candidates_enumerated=3))
        self.assertEqual(result, WaitKind.HEALTHY_WAIT)


class EvaluateFalseRejectTests(unittest.TestCase):
    def _reject_outcome(self, **overrides) -> RejectedCandidateOutcome:
        base = dict(
            candidate_id="c1", reject_reason="LIQUIDITY_BELOW_POLICY",
            would_have_realized_net_pnl=None, would_have_required_tail_exposure=None,
            would_have_locked_capital_days=None, execution_would_have_been_feasible=None,
        )
        base.update(overrides)
        return RejectedCandidateOutcome(**base)

    def test_missing_any_required_field_is_unknown(self):
        outcome = self._reject_outcome(would_have_realized_net_pnl=100.0)
        self.assertEqual(evaluate_false_reject(outcome, minimum_tail_adjusted_edge=0.0), RejectOutcomeState.UNKNOWN)

    def test_infeasible_fill_is_correct_reject_regardless_of_theoretical_pnl(self):
        outcome = self._reject_outcome(
            would_have_realized_net_pnl=1000.0, would_have_required_tail_exposure=10.0,
            execution_would_have_been_feasible=False,
        )
        self.assertEqual(evaluate_false_reject(outcome, minimum_tail_adjusted_edge=0.0), RejectOutcomeState.CORRECT_REJECT)

    def test_profitable_but_below_tail_adjusted_bar_is_still_correct_reject(self):
        # Money alone is not sufficient -- must clear the tail-adjusted bar.
        outcome = self._reject_outcome(
            would_have_realized_net_pnl=50.0, would_have_required_tail_exposure=45.0,
            execution_would_have_been_feasible=True,
        )
        self.assertEqual(evaluate_false_reject(outcome, minimum_tail_adjusted_edge=20.0), RejectOutcomeState.CORRECT_REJECT)

    def test_genuine_false_reject_clears_both_bars(self):
        outcome = self._reject_outcome(
            would_have_realized_net_pnl=200.0, would_have_required_tail_exposure=10.0,
            execution_would_have_been_feasible=True,
        )
        self.assertEqual(evaluate_false_reject(outcome, minimum_tail_adjusted_edge=20.0), RejectOutcomeState.FALSE_REJECT)


class WaitKindDistributionTests(unittest.TestCase):
    def test_tallies_every_kind_including_zero_counts(self):
        counts = wait_kind_distribution([WaitKind.HEALTHY_WAIT, WaitKind.HEALTHY_WAIT, WaitKind.DATA_WAIT])
        self.assertEqual(counts[WaitKind.HEALTHY_WAIT], 2)
        self.assertEqual(counts[WaitKind.DATA_WAIT], 1)
        self.assertEqual(counts[WaitKind.QUOTE_WAIT], 0)
        self.assertEqual(len(counts), len(WaitKind))


if __name__ == "__main__":
    unittest.main()
