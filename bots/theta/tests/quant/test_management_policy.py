"""Tests for bots/theta/quant/research/management_policy.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.management_policy import (  # noqa: E402
    ActionEconomics,
    GlobalWaitEvidence,
    GlobalWaitReason,
    LossPolicy,
    ManagementAction,
    ManagementDecisionExplanation,
    ProfitTakingPolicy,
    management_utility,
    validate_global_wait_evidence,
)


class PolicyEnumTests(unittest.TestCase):
    def test_profit_taking_policy_has_all_eight_named_variants(self):
        expected = {
            "FIXED_25", "FIXED_50", "FIXED_75", "TIME_EXIT", "DTE_EXIT",
            "DYNAMIC_REMAINING_EV", "DYNAMIC_EV_PLUS_HARD_RISK", "DYNAMIC_EV_PLUS_FLOW_INVALIDATION",
        }
        self.assertEqual({v.value for v in ProfitTakingPolicy}, expected)

    def test_loss_policy_has_all_six_named_variants(self):
        expected = {
            "FIXED_OPTION_PREMIUM_STOP", "THESIS_INVALIDATION", "DYNAMIC_CONTINUATION_EV",
            "ROLL_WHEN_INCREMENTAL_EV_POSITIVE", "ASSIGN_WHEN_OWNERSHIP_EV_POSITIVE",
            "HYBRID_HARD_TAIL_LIMIT_PLUS_DYNAMIC",
        }
        self.assertEqual({v.value for v in LossPolicy}, expected)


class ManagementUtilityTests(unittest.TestCase):
    def test_unknown_remaining_ev_makes_utility_unknown(self):
        econ = ActionEconomics(ManagementAction.HOLD, remaining_ev=None, tail_risk=1.0, capital_days_consumed=1.0, execution_cost=0.0)
        self.assertIsNone(management_utility(econ, 1.0, 1.0, 1.0))

    def test_utility_subtracts_all_three_weighted_penalties(self):
        econ = ActionEconomics(ManagementAction.ROLL, remaining_ev=100.0, tail_risk=10.0, capital_days_consumed=5.0, execution_cost=2.0)
        utility = management_utility(econ, tail_risk_aversion=2.0, capital_day_cost=1.0, execution_risk_aversion=3.0)
        self.assertAlmostEqual(utility, 100.0 - 2.0 * 10.0 - 1.0 * 5.0 - 3.0 * 2.0)

    def test_missing_optional_fields_default_to_zero_penalty_not_none_propagation(self):
        econ = ActionEconomics(ManagementAction.CLOSE_FULL, remaining_ev=50.0, tail_risk=None, capital_days_consumed=None, execution_cost=None)
        utility = management_utility(econ, 1.0, 1.0, 1.0)
        self.assertAlmostEqual(utility, 50.0)

    def test_opportunity_cost_is_subtracted_when_supplied(self):
        econ = ActionEconomics(ManagementAction.HOLD, remaining_ev=50.0, tail_risk=0.0, capital_days_consumed=0.0, execution_cost=0.0)
        utility = management_utility(econ, 1.0, 1.0, 1.0, opportunity_cost=20.0)
        self.assertAlmostEqual(utility, 30.0)


class ManagementDecisionExplanationTests(unittest.TestCase):
    def test_rejected_alternatives_excludes_only_the_chosen_action(self):
        hold = ActionEconomics(ManagementAction.HOLD, remaining_ev=10.0, tail_risk=1.0, capital_days_consumed=1.0, execution_cost=0.0)
        close = ActionEconomics(ManagementAction.CLOSE_FULL, remaining_ev=5.0, tail_risk=0.5, capital_days_consumed=0.0, execution_cost=1.0)
        roll = ActionEconomics(ManagementAction.ROLL, remaining_ev=8.0, tail_risk=2.0, capital_days_consumed=2.0, execution_cost=1.5)

        explanation = ManagementDecisionExplanation(
            position_label="AAPL CSP",
            actions_considered=(hold, close, roll),
            utilities=(9.0, 3.5, 4.5),
            chosen_action=ManagementAction.CLOSE_FULL,
            reason="remaining reward does not compensate for risk/capital usage",
        )
        rejected = explanation.rejected_alternatives()
        self.assertEqual(len(rejected), 2)
        self.assertNotIn(ManagementAction.CLOSE_FULL, [a for a, _ in rejected])
        self.assertIn(ManagementAction.HOLD, [a for a, _ in rejected])
        self.assertIn(ManagementAction.ROLL, [a for a, _ in rejected])


class GlobalWaitEvidenceTests(unittest.TestCase):
    def _full_evidence(self, **overrides):
        defaults = dict(
            underlyings_evaluated=50, contracts_evaluated=500,
            validated_branches_evaluated=("THETA-Q", "THETA-C"),
            existing_position_management_evaluated=True,
            recovery_opportunities_evaluated=True,
            cc_opportunities_evaluated=True,
            redeployment_alternatives_evaluated=True,
            reason=GlobalWaitReason.NO_POSITIVE_AFTER_COST_EV,
            reason_detail="every eligible candidate failed after-cost EV",
        )
        defaults.update(overrides)
        return GlobalWaitEvidence(**defaults)

    def test_a_fully_exhaustive_scan_earns_the_wait(self):
        violations = validate_global_wait_evidence(self._full_evidence(), min_underlyings_evaluated=30)
        self.assertEqual(violations, [])

    def test_a_preferred_filter_failing_alone_does_not_earn_a_global_wait(self):
        # Only 1 underlying evaluated (the preferred one) -- this is
        # exactly the "one preferred CSP filter failed" case the directive
        # says must NOT be enough to justify a global WAIT.
        violations = validate_global_wait_evidence(
            self._full_evidence(underlyings_evaluated=1), min_underlyings_evaluated=30,
        )
        self.assertGreater(len(violations), 0)

    def test_skipping_recovery_opportunities_is_flagged(self):
        violations = validate_global_wait_evidence(
            self._full_evidence(recovery_opportunities_evaluated=False), min_underlyings_evaluated=30,
        )
        self.assertTrue(any("recovery" in v for v in violations))

    def test_skipping_cc_opportunities_is_flagged(self):
        violations = validate_global_wait_evidence(
            self._full_evidence(cc_opportunities_evaluated=False), min_underlyings_evaluated=30,
        )
        self.assertTrue(any("covered-call" in v for v in violations))

    def test_zero_validated_branches_is_flagged(self):
        violations = validate_global_wait_evidence(
            self._full_evidence(validated_branches_evaluated=()), min_underlyings_evaluated=30,
        )
        self.assertTrue(any("branch" in v for v in violations))


if __name__ == "__main__":
    unittest.main()
