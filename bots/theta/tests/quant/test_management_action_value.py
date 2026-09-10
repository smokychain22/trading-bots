"""Tests for bots/theta/quant/models/management_action_value.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.candidate_actions import CandidateAction  # noqa: E402
from models.management_action_value import (  # noqa: E402
    ActionValuation,
    AssignAlternative,
    ManagementContext,
    ManagementPolicy,
    OpenOptionLegState,
    RedeployAlternative,
    RollCandidate,
    evaluate_management_alternatives,
    hold_advantage,
)


def _policy(**overrides) -> ManagementPolicy:
    defaults = dict(
        policy_version="TEST-MGMT-1",
        execution_cost_per_contract=1.0,
        capital_days_penalty_rate=0.0001,
        tail_risk_penalty_weight=1.0,
    )
    defaults.update(overrides)
    return ManagementPolicy(**defaults)


def _leg(**overrides) -> OpenOptionLegState:
    defaults = dict(
        entry_credit_per_share=0.60,
        current_bid_per_share=0.30,
        current_ask_per_share=0.35,
        strike=50.0,
        multiplier=100.0,
        dte=10,
    )
    defaults.update(overrides)
    return OpenOptionLegState(**defaults)


def _ctx(**overrides) -> ManagementContext:
    defaults = dict(
        as_of="2026-09-10T00:00:00Z",
        open_option_leg=_leg(),
        roll_candidate=None,
        assign_alternative=None,
        redeploy_alternative=None,
        capital_committed=5000.0,
        hold_forward_value=None,
        p_severe_drawdown=0.05,
        at_expiration_otm=False,
    )
    defaults.update(overrides)
    return ManagementContext(**defaults)


class HoldDefaultTests(unittest.TestCase):
    def test_hold_selected_when_no_alternative_beats_it(self):
        # No roll/assign/redeploy alternative supplied at all -- HOLD is the
        # only feasible, valuable action, so it must be selected, never a
        # forced trade.
        decision = evaluate_management_alternatives(_policy(), _ctx(open_option_leg=None))
        self.assertEqual(decision.selected_action, CandidateAction.HOLD)
        self.assertIn("HOLD_SELECTED_AS_DEFAULT", [r.code for r in decision.selected_reasons])

    def test_hold_selected_when_closing_would_lock_in_a_bigger_loss(self):
        # The leg has moved against us (current ask exceeds entry credit);
        # closing now would crystallize a larger loss than the modest
        # expected forward cost of continuing to hold.
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.90, multiplier=100.0),
            hold_forward_value=-10.0,
            capital_committed=1000.0,
            p_severe_drawdown=0.01,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        self.assertEqual(decision.selected_action, CandidateAction.HOLD)


class CloseTests(unittest.TestCase):
    def test_close_computes_realized_cashflow(self):
        ctx = _ctx(open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.35, multiplier=100.0))
        decision = evaluate_management_alternatives(_policy(execution_cost_per_contract=1.0), ctx)
        close = next(v for v in decision.valuations if v.action is CandidateAction.CLOSE)
        self.assertAlmostEqual(close.certain_cashflow, (0.60 - 0.35) * 100.0, places=6)
        self.assertAlmostEqual(close.utility, (0.60 - 0.35) * 100.0 - 1.0, places=6)

    def test_close_unknown_quote_never_becomes_zero(self):
        ctx = _ctx(open_option_leg=_leg(current_ask_per_share=None))
        decision = evaluate_management_alternatives(_policy(), ctx)
        close = next(v for v in decision.valuations if v.action is CandidateAction.CLOSE)
        self.assertIsNone(close.utility)
        self.assertIn("CLOSE_QUOTE_UNKNOWN", [r.code for r in close.reasons])
        # And the unknown CLOSE must never be selected over the safe HOLD default.
        self.assertNotEqual(decision.selected_action, CandidateAction.CLOSE)

    def test_close_infeasible_without_open_leg(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(open_option_leg=None))
        close = next(v for v in decision.valuations if v.action is CandidateAction.CLOSE)
        self.assertFalse(close.feasible)


class ExpireTests(unittest.TestCase):
    def test_expire_captures_full_premium_when_otm_at_expiration(self):
        ctx = _ctx(open_option_leg=_leg(entry_credit_per_share=0.60, multiplier=100.0, dte=0), at_expiration_otm=True)
        decision = evaluate_management_alternatives(_policy(), ctx)
        expire = next(v for v in decision.valuations if v.action is CandidateAction.EXPIRE)
        self.assertAlmostEqual(expire.utility, 60.0, places=6)

    def test_expire_infeasible_when_not_at_expiration(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(at_expiration_otm=False))
        expire = next(v for v in decision.valuations if v.action is CandidateAction.EXPIRE)
        self.assertFalse(expire.feasible)


class RollTests(unittest.TestCase):
    def test_positive_roll_credit_but_negative_incremental_ev_is_rejected(self):
        # NetRollCredit is positive on its own, but the new leg's estimated
        # future value is bad enough that overall utility is negative and
        # worse than HOLD -- ROLL must not be chosen just because the
        # immediate credit looked good (H-R-03).
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.10, multiplier=100.0),
            roll_candidate=RollCandidate(
                new_strike=45.0, new_dte=30, new_credit_per_share=0.80,
                estimated_future_value=-500.0,  # deeply unfavorable new leg
            ),
            hold_forward_value=0.0,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        roll = next(v for v in decision.valuations if v.action is CandidateAction.ROLL)
        self.assertGreater(roll.certain_cashflow, 0.0)  # net roll credit is positive
        self.assertLess(roll.utility, 0.0)  # but overall utility is negative
        self.assertNotEqual(decision.selected_action, CandidateAction.ROLL)

    def test_roll_selected_when_genuinely_superior(self):
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.10, multiplier=100.0),
            roll_candidate=RollCandidate(
                new_strike=45.0, new_dte=30, new_credit_per_share=0.80,
                estimated_future_value=300.0,  # comfortably clears the tail-risk penalty and beats CLOSE
            ),
            hold_forward_value=0.0,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        self.assertEqual(decision.selected_action, CandidateAction.ROLL)

    def test_roll_unknown_future_value_is_not_silently_assumed_good(self):
        ctx = _ctx(
            open_option_leg=_leg(current_ask_per_share=0.10),
            roll_candidate=RollCandidate(new_strike=45.0, new_dte=30, new_credit_per_share=0.80, estimated_future_value=None),
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        roll = next(v for v in decision.valuations if v.action is CandidateAction.ROLL)
        self.assertIsNone(roll.utility)
        self.assertIn("ROLL_FUTURE_VALUE_UNKNOWN", [r.code for r in roll.reasons])

    def test_roll_infeasible_without_candidate(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(roll_candidate=None))
        roll = next(v for v in decision.valuations if v.action is CandidateAction.ROLL)
        self.assertFalse(roll.feasible)


class AssignmentPreferenceTests(unittest.TestCase):
    def test_assignment_preferred_over_a_bad_roll(self):
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.10, multiplier=100.0),
            roll_candidate=RollCandidate(
                new_strike=45.0, new_dte=30, new_credit_per_share=0.80,
                estimated_future_value=-1000.0,  # a bad roll
            ),
            assign_alternative=AssignAlternative(estimated_future_value=400.0),  # accepting assignment is fine
            hold_forward_value=0.0,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        self.assertEqual(decision.selected_action, CandidateAction.ASSIGN)

    def test_assignment_infeasible_when_not_offered(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(assign_alternative=None))
        assign = next(v for v in decision.valuations if v.action is CandidateAction.ASSIGN)
        self.assertFalse(assign.feasible)


class RedeployTests(unittest.TestCase):
    def test_redeploy_selected_when_clearly_best(self):
        ctx = _ctx(
            open_option_leg=None,
            redeploy_alternative=RedeployAlternative(estimated_future_value=500.0),
            hold_forward_value=0.0,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        self.assertEqual(decision.selected_action, CandidateAction.REDEPLOY)


class CapitalDaysPenaltyTests(unittest.TestCase):
    def test_capital_days_penalty_scales_with_committed_capital_and_days(self):
        policy = _policy(capital_days_penalty_rate=0.001)
        ctx = _ctx(
            open_option_leg=_leg(current_ask_per_share=0.10),
            roll_candidate=RollCandidate(new_strike=45.0, new_dte=60, new_credit_per_share=0.80, estimated_future_value=0.0),
            capital_committed=10000.0,
        )
        decision = evaluate_management_alternatives(policy, ctx)
        roll = next(v for v in decision.valuations if v.action is CandidateAction.ROLL)
        self.assertAlmostEqual(roll.capital_days_penalty, 0.001 * 10000.0 * 60, places=6)

    def test_capital_days_penalty_unknown_without_capital_committed(self):
        ctx = _ctx(
            capital_committed=None,
            roll_candidate=RollCandidate(new_strike=45.0, new_dte=30, new_credit_per_share=0.80, estimated_future_value=5.0),
            open_option_leg=_leg(current_ask_per_share=0.10),
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        roll = next(v for v in decision.valuations if v.action is CandidateAction.ROLL)
        self.assertIsNone(roll.capital_days_penalty)
        self.assertIsNone(roll.utility)


class HoldAdvantageTests(unittest.TestCase):
    def test_positive_hold_advantage_when_hold_dominates(self):
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.90, multiplier=100.0),
            hold_forward_value=-10.0, capital_committed=1000.0, p_severe_drawdown=0.01,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        advantage = hold_advantage(decision)
        self.assertIsNotNone(advantage)
        self.assertGreater(advantage, 0.0)

    def test_negative_hold_advantage_when_an_alternative_dominates(self):
        ctx = _ctx(
            open_option_leg=_leg(entry_credit_per_share=0.60, current_ask_per_share=0.10, multiplier=100.0),
            redeploy_alternative=RedeployAlternative(estimated_future_value=500.0),
            hold_forward_value=0.0,
        )
        decision = evaluate_management_alternatives(_policy(), ctx)
        advantage = hold_advantage(decision)
        self.assertIsNotNone(advantage)
        self.assertLess(advantage, 0.0)

    def test_hold_advantage_is_unknown_when_hold_forward_value_is_unknown(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(hold_forward_value=None))
        self.assertIsNone(hold_advantage(decision))

    def test_hold_advantage_is_unknown_when_no_alternative_has_a_known_utility(self):
        decision = evaluate_management_alternatives(_policy(), _ctx(open_option_leg=None, hold_forward_value=50.0))
        self.assertIsNone(hold_advantage(decision))


class SameTimestampComparisonTests(unittest.TestCase):
    def test_all_valuations_share_one_context_snapshot(self):
        # Structural guard: evaluate_management_alternatives takes exactly
        # one ManagementContext and every valuation is derived from it --
        # there is no code path that accepts a second, later context for
        # any individual action.
        import inspect
        from models import management_action_value as mav

        signature = inspect.signature(mav.evaluate_management_alternatives)
        self.assertEqual(list(signature.parameters), ["policy", "ctx"])


if __name__ == "__main__":
    unittest.main()
