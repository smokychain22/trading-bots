"""Tests for bots/theta/quant/research/follower_copy_economics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.account_risk_capacity import AccountRiskCapacity, AccountRole  # noqa: E402
from research.follower_copy_economics import (  # noqa: E402
    ChainLifecycleEvent,
    CopyDecision,
    CopyTimeline,
    FollowerChainParticipation,
    FollowerSizingInputs,
    R4ExitCheck,
    assess_copyability,
    compute_copy_delay_seconds,
    compute_edge_degradation,
    compute_follower_quantity,
    compute_price_deterioration,
    compute_return_degradation_pct,
    evaluate_follower_roll,
    follower_may_participate,
    r4_quant_copy_contract,
)


def _follower_capacity(**overrides):
    defaults = dict(
        account_id="follower-1", account_role=AccountRole.FOLLOWER, equity=20_000.0,
        collateral_capacity=10_000.0, assignment_capacity=200.0, portfolio_tail_budget=2_000.0,
        concentration_capacity={"SPY": 5_000.0},
    )
    defaults.update(overrides)
    return AccountRiskCapacity(**defaults)


def _inputs(**overrides):
    defaults = dict(
        follower_capacity=_follower_capacity(), required_collateral_per_contract=5_000.0,
        stress_loss_per_contract=100.0, concentration_key="SPY", exposure_per_contract=1_000.0,
        assignment_shares_per_contract=100.0, master_quantity=5,
    )
    defaults.update(overrides)
    return FollowerSizingInputs(**defaults)


class ComputeFollowerQuantityTests(unittest.TestCase):
    def test_follower_quantity_is_capped_by_its_own_account_capacity(self):
        # collateral cap = 10000/5000 = 2, well below master_quantity=5
        qty = compute_follower_quantity(_inputs())
        self.assertEqual(qty, 2)

    def test_follower_quantity_never_exceeds_master_quantity_even_with_huge_capacity(self):
        capacity = _follower_capacity(collateral_capacity=1_000_000.0, assignment_capacity=100_000.0,
                                       portfolio_tail_budget=1_000_000.0, concentration_capacity={"SPY": 1_000_000.0})
        qty = compute_follower_quantity(_inputs(follower_capacity=capacity, master_quantity=3))
        self.assertEqual(qty, 3)

    def test_zero_capacity_yields_zero_never_a_forced_minimum(self):
        capacity = _follower_capacity(collateral_capacity=0.0)
        qty = compute_follower_quantity(_inputs(follower_capacity=capacity))
        self.assertEqual(qty, 0)


class PriceDeteriorationTests(unittest.TestCase):
    def test_computes_signed_deterioration(self):
        deterioration = compute_price_deterioration(master_fill_price=1.00, follower_actual_fill_price=1.05)
        self.assertAlmostEqual(deterioration, 0.05)

    def test_unknown_inputs_produce_none_never_zero(self):
        self.assertIsNone(compute_price_deterioration(None, 1.05))
        self.assertIsNone(compute_price_deterioration(1.00, None))


class AssessCopyabilityTests(unittest.TestCase):
    def test_full_capacity_and_fresh_quote_and_compatible_branch_is_copy_eligible(self):
        capacity = _follower_capacity(collateral_capacity=1_000_000.0, assignment_capacity=100_000.0,
                                       portfolio_tail_budget=1_000_000.0, concentration_capacity={"SPY": 1_000_000.0})
        assessment = assess_copyability(_inputs(follower_capacity=capacity), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.COPY_ELIGIBLE)

    def test_binding_capacity_below_master_quantity_is_copy_reduced(self):
        assessment = assess_copyability(_inputs(), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.COPY_REDUCED)

    def test_zero_quantity_is_skip(self):
        capacity = _follower_capacity(collateral_capacity=0.0)
        assessment = assess_copyability(_inputs(follower_capacity=capacity), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)
        self.assertTrue(any("ZERO_QUANTITY" in r for r in assessment.reasons))

    def test_incompatible_branch_is_skip_regardless_of_capacity(self):
        assessment = assess_copyability(_inputs(), branch_compatible=False, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_stale_quote_is_skip(self):
        assessment = assess_copyability(_inputs(), branch_compatible=True, quote_fresh=False, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_account_isolation_violation_is_an_unconditional_skip(self):
        assessment = assess_copyability(
            _inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=["accounts share the identical capacity object"],
        )
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_every_non_eligible_decision_carries_an_explicit_reason(self):
        assessment = assess_copyability(_inputs(), branch_compatible=False, quote_fresh=True, account_isolation_violations=[])
        self.assertGreater(len(assessment.reasons), 0)


class LifecycleEligibilityTests(unittest.TestCase):
    """A follower that skipped ENTRY must remain absent from that chain's
    whole downstream lifecycle -- copying a close for a position never
    opened would manufacture a phantom short."""

    def _skipped(self):
        return FollowerChainParticipation(chain_id="chain-1", entered=False)

    def _entered_with_option(self):
        return FollowerChainParticipation(chain_id="chain-1", entered=True, open_option_quantity=1.0)

    def test_a_follower_that_skipped_entry_cannot_copy_any_downstream_event(self):
        skipped = self._skipped()
        for event in (ChainLifecycleEvent.CLOSE, ChainLifecycleEvent.ROLL_CLOSE_OLD,
                       ChainLifecycleEvent.ROLL_OPEN_NEW, ChainLifecycleEvent.ASSIGNMENT,
                       ChainLifecycleEvent.SELL_CC, ChainLifecycleEvent.CALL_AWAY):
            may, reason = follower_may_participate(skipped, event)
            self.assertFalse(may, f"{event.value} must be refused for a chain never entered")
            self.assertIn("NEVER_ENTERED_CHAIN", reason)

    def test_entry_is_always_the_followers_own_independent_decision(self):
        may, _ = follower_may_participate(self._skipped(), ChainLifecycleEvent.ENTRY)
        self.assertTrue(may)

    def test_a_follower_holding_the_option_may_close_it(self):
        may, _ = follower_may_participate(self._entered_with_option(), ChainLifecycleEvent.CLOSE)
        self.assertTrue(may)

    def test_an_entered_follower_holding_no_option_cannot_be_assigned(self):
        participation = FollowerChainParticipation(chain_id="chain-1", entered=True, open_option_quantity=0.0)
        may, reason = follower_may_participate(participation, ChainLifecycleEvent.ASSIGNMENT)
        self.assertFalse(may)
        self.assertIn("NO_SHORT_OPTION", reason)

    def test_a_follower_without_shares_cannot_sell_a_covered_call(self):
        participation = FollowerChainParticipation(chain_id="chain-1", entered=True, owns_assigned_shares=False)
        may, reason = follower_may_participate(participation, ChainLifecycleEvent.SELL_CC)
        self.assertFalse(may)
        self.assertIn("OWNS_NO_SHARES", reason)

    def test_a_follower_without_an_open_cc_cannot_be_called_away(self):
        participation = FollowerChainParticipation(chain_id="chain-1", entered=True, owns_assigned_shares=True,
                                                    has_open_covered_call=False)
        may, reason = follower_may_participate(participation, ChainLifecycleEvent.CALL_AWAY)
        self.assertFalse(may)
        self.assertIn("NO_OPEN_COVERED_CALL", reason)


class RollSemanticsTests(unittest.TestCase):
    """A master roll is two independent legs, never one magical action."""

    def _participation(self, entered=True):
        return FollowerChainParticipation(chain_id="chain-1", entered=entered, open_option_quantity=1.0)

    def test_follower_may_close_the_old_leg_and_skip_the_new_one(self):
        # Zero capacity for the new leg -- close old, skip new.
        broke = _follower_capacity(collateral_capacity=0.0)
        decision = evaluate_follower_roll(
            self._participation(), _inputs(follower_capacity=broke),
            new_leg_branch_compatible=True, new_leg_quote_fresh=True, account_isolation_violations=[],
        )
        self.assertNotEqual(decision.close_old_decision, CopyDecision.SKIP)
        self.assertEqual(decision.open_new_decision, CopyDecision.SKIP)
        self.assertTrue(decision.is_partial_roll)

    def test_a_follower_that_never_entered_skips_both_legs(self):
        decision = evaluate_follower_roll(
            self._participation(entered=False), _inputs(),
            new_leg_branch_compatible=True, new_leg_quote_fresh=True, account_isolation_violations=[],
        )
        self.assertEqual(decision.close_old_decision, CopyDecision.SKIP)
        self.assertEqual(decision.open_new_decision, CopyDecision.SKIP)
        self.assertFalse(decision.is_partial_roll)

    def test_a_stale_new_leg_quote_skips_only_the_new_leg(self):
        decision = evaluate_follower_roll(
            self._participation(), _inputs(),
            new_leg_branch_compatible=True, new_leg_quote_fresh=False, account_isolation_violations=[],
        )
        self.assertNotEqual(decision.close_old_decision, CopyDecision.SKIP)
        self.assertEqual(decision.open_new_decision, CopyDecision.SKIP)


class DegradationMetricTests(unittest.TestCase):
    def test_copy_delay_is_none_when_a_timestamp_is_missing(self):
        timeline = CopyTimeline(master_decision_time=None, master_fill_time=None,
                                 copy_event_time=None, follower_observation_time=None, follower_fill_time=None)
        self.assertIsNone(compute_copy_delay_seconds(timeline))

    def test_copy_delay_is_computed_when_both_fills_are_known(self):
        timeline = CopyTimeline(
            master_decision_time="2026-01-01T14:30:00+00:00", master_fill_time="2026-01-01T14:30:00+00:00",
            copy_event_time="2026-01-01T14:30:01+00:00", follower_observation_time="2026-01-01T14:30:02+00:00",
            follower_fill_time="2026-01-01T14:30:05+00:00",
        )
        self.assertAlmostEqual(compute_copy_delay_seconds(timeline), 5.0)

    def test_edge_degradation_is_none_until_an_ev_model_exists(self):
        self.assertIsNone(compute_edge_degradation(None, None))
        self.assertIsNone(compute_edge_degradation(10.0, None))

    def test_return_degradation_is_none_when_master_return_is_zero(self):
        self.assertIsNone(compute_return_degradation_pct(0.0, 5.0))

    def test_return_degradation_is_signed_relative_shortfall(self):
        self.assertAlmostEqual(compute_return_degradation_pct(0.10, 0.08), -0.2)


class R4ExitCheckTests(unittest.TestCase):
    def _check(self, **overrides):
        fields = {name: True for name in R4ExitCheck.__dataclass_fields__}
        fields.update(overrides)
        return R4ExitCheck(**fields)

    def test_all_criteria_satisfied_is_pass(self):
        self.assertEqual(r4_quant_copy_contract(self._check()), "PASS")

    def test_any_unmet_criterion_is_fail(self):
        for name in R4ExitCheck.__dataclass_fields__:
            self.assertEqual(r4_quant_copy_contract(self._check(**{name: False})), "FAIL", f"{name}=False must FAIL")


if __name__ == "__main__":
    unittest.main()
