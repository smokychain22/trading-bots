"""Tests for bots/theta/quant/models/opportunity_frontier.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.opportunity_frontier import (  # noqa: E402
    CandidateDisposition,
    CandidateSnapshot,
    GlobalIdleReason,
    OpportunityFrontierPolicy,
    WaitReason,
    build_opportunity_book,
)


def _policy(**overrides) -> OpportunityFrontierPolicy:
    defaults = dict(policy_version="TEST-FRONTIER-1", reduced_size_uncertainty_threshold=0.5)
    defaults.update(overrides)
    return OpportunityFrontierPolicy(**defaults)


def _candidate(**overrides) -> CandidateSnapshot:
    defaults = dict(
        candidate_id="C1", underlying_symbol="AAPL", ev_net=50.0, return_per_capital_day=0.002,
        ownership_acceptable=True, liquidity_acceptable=True, iv_compensation_sufficient=True,
        event_near=False, regime_acceptable=True, model_uncertainty=0.1,
        aegis_permits_full=True, aegis_permits_reduced=True,
        has_alternate_contract=False, has_alternate_structure=False,
    )
    defaults.update(overrides)
    return CandidateSnapshot(**defaults)


class OneBadCandidateDoesNotFreezeTheBookTests(unittest.TestCase):
    def test_a_single_wait_candidate_does_not_prevent_another_from_opening(self):
        # This is the central anti-paralysis guarantee: AAPL waiting on an
        # event must not stop GOOG from opening.
        aapl = _candidate(candidate_id="AAPL", underlying_symbol="AAPL", event_near=True)
        goog = _candidate(candidate_id="GOOG", underlying_symbol="GOOG")
        book = build_opportunity_book(_policy(), [aapl, goog])
        self.assertEqual(len(book.actionable_entries), 1)
        self.assertEqual(book.actionable_entries[0].candidate.candidate_id, "GOOG")
        self.assertIsNone(book.global_idle)

    def test_both_wait_and_pass_can_coexist_with_an_open_candidate(self):
        wait_candidate = _candidate(candidate_id="WAITER", event_near=True)
        pass_candidate = _candidate(candidate_id="PASSER", ownership_acceptable=False)
        open_candidate = _candidate(candidate_id="OPENER", underlying_symbol="MSFT")
        book = build_opportunity_book(_policy(), [wait_candidate, pass_candidate, open_candidate])
        self.assertEqual(len(book.actionable_entries), 1)
        self.assertEqual(book.actionable_entries[0].candidate.candidate_id, "OPENER")


class WaitVsPassDistinctionTests(unittest.TestCase):
    def test_ownership_unacceptable_is_pass_not_wait(self):
        decision = build_opportunity_book(_policy(), [_candidate(ownership_acceptable=False)]).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.PASS)
        self.assertIsNone(decision.wait_reason)

    def test_negative_ev_is_pass_not_wait(self):
        decision = build_opportunity_book(_policy(), [_candidate(ev_net=-5.0)]).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.PASS)

    def test_event_proximity_is_wait_event_not_pass(self):
        decision = build_opportunity_book(_policy(), [_candidate(event_near=True)]).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.WAIT)
        self.assertEqual(decision.wait_reason, WaitReason.WAIT_EVENT)

    def test_liquidity_unacceptable_is_wait_liquidity(self):
        decision = build_opportunity_book(_policy(), [_candidate(liquidity_acceptable=False)]).entries[0].decision
        self.assertEqual(decision.wait_reason, WaitReason.WAIT_LIQUIDITY)

    def test_iv_insufficient_is_wait_vol(self):
        decision = build_opportunity_book(_policy(), [_candidate(iv_compensation_sufficient=False)]).entries[0].decision
        self.assertEqual(decision.wait_reason, WaitReason.WAIT_VOL)

    def test_regime_unfavorable_is_wait_regime(self):
        decision = build_opportunity_book(_policy(), [_candidate(regime_acceptable=False)]).entries[0].decision
        self.assertEqual(decision.wait_reason, WaitReason.WAIT_REGIME)

    def test_unknown_required_input_is_pass_never_treated_as_acceptable(self):
        decision = build_opportunity_book(_policy(), [_candidate(ownership_acceptable=None)]).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.PASS)
        self.assertEqual(decision.rejection_category, "UNKNOWN_INPUT")


class UncertaintyDoesNotForceWaitTests(unittest.TestCase):
    def test_elevated_uncertainty_reduces_size_rather_than_rejecting(self):
        decision = build_opportunity_book(
            _policy(reduced_size_uncertainty_threshold=0.3), [_candidate(model_uncertainty=0.8)]
        ).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.OPEN_REDUCED)

    def test_low_uncertainty_with_full_aegis_permission_opens_full(self):
        decision = build_opportunity_book(_policy(), [_candidate(model_uncertainty=0.05)]).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.OPEN_FULL)


class AegisFallbackTests(unittest.TestCase):
    def test_aegis_blocked_falls_back_to_defined_risk_structure_before_passing(self):
        decision = build_opportunity_book(
            _policy(), [_candidate(aegis_permits_full=False, aegis_permits_reduced=False, has_alternate_structure=True)]
        ).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.OPEN_ALTERNATE_STRUCTURE)

    def test_aegis_blocked_with_no_fallback_is_pass_with_aegis_category(self):
        decision = build_opportunity_book(
            _policy(), [_candidate(aegis_permits_full=False, aegis_permits_reduced=False)]
        ).entries[0].decision
        self.assertEqual(decision.disposition, CandidateDisposition.PASS)
        self.assertEqual(decision.rejection_category, "AEGIS")


class GlobalIdleExplainabilityTests(unittest.TestCase):
    def test_all_aegis_rejected_reports_portfolio_risk_cap_reached(self):
        candidates = [
            _candidate(candidate_id="A", aegis_permits_full=False, aegis_permits_reduced=False),
            _candidate(candidate_id="B", aegis_permits_full=False, aegis_permits_reduced=False),
        ]
        book = build_opportunity_book(_policy(), candidates)
        self.assertIsNotNone(book.global_idle)
        self.assertEqual(book.global_idle.reason, GlobalIdleReason.PORTFOLIO_RISK_CAP_REACHED)
        self.assertEqual(book.global_idle.contracts_evaluated, 2)
        self.assertEqual(book.global_idle.eligible_underlyings_scanned, 1)

    def test_global_idle_report_names_the_best_rejected_candidate(self):
        candidates = [
            _candidate(candidate_id="WORSE", ev_net=-100.0),
            _candidate(candidate_id="BETTER", ev_net=-5.0),
        ]
        book = build_opportunity_book(_policy(), candidates)
        self.assertEqual(book.global_idle.best_rejected_candidate_id, "BETTER")
        self.assertEqual(book.global_idle.best_rejected_ev, -5.0)

    def test_empty_candidate_list_reports_market_data_invalid(self):
        book = build_opportunity_book(_policy(), [])
        self.assertEqual(book.global_idle.reason, GlobalIdleReason.MARKET_DATA_INVALID)

    def test_global_idle_never_returned_when_any_candidate_qualifies(self):
        candidates = [_candidate(candidate_id="BAD", ev_net=-1.0), _candidate(candidate_id="GOOD")]
        book = build_opportunity_book(_policy(), candidates)
        self.assertIsNone(book.global_idle)


class RankingTests(unittest.TestCase):
    def test_actionable_entries_ranked_by_return_per_capital_day_descending(self):
        candidates = [
            _candidate(candidate_id="LOW", return_per_capital_day=0.001),
            _candidate(candidate_id="HIGH", return_per_capital_day=0.01),
        ]
        book = build_opportunity_book(_policy(), candidates)
        self.assertEqual([e.candidate.candidate_id for e in book.actionable_entries], ["HIGH", "LOW"])
        self.assertEqual(book.actionable_entries[0].rank, 1)
        self.assertEqual(book.actionable_entries[1].rank, 2)

    def test_unranked_return_per_capital_day_sorts_last_not_first(self):
        candidates = [
            _candidate(candidate_id="UNKNOWN_RETURN", return_per_capital_day=None),
            _candidate(candidate_id="KNOWN_RETURN", return_per_capital_day=0.001),
        ]
        book = build_opportunity_book(_policy(), candidates)
        self.assertEqual(book.actionable_entries[0].candidate.candidate_id, "KNOWN_RETURN")


if __name__ == "__main__":
    unittest.main()
