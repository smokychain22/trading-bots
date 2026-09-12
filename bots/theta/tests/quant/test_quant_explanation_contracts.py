"""Tests for bots/theta/quant/research/quant_explanation_contracts.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.action_value_distribution import unknown_distribution  # noqa: E402
from research.champion_challenger import BranchStatus  # noqa: E402
from research.dataset_contracts import ThetaStrategyAction  # noqa: E402
from research.quant_explanation_contracts import (  # noqa: E402
    REQUIRED_POSITION_EXPLANATION_ACTIONS,
    CandidateExplanation,
    PerformanceExplanation,
    PositionExplanation,
    R5ExitCheck,
    StrategyExplanation,
    missing_position_explanation_actions,
    r5_quant_explanation_contract,
    validate_explanation_consistency,
    validate_no_uncalibrated_confidence,
)


class CandidateExplanationTests(unittest.TestCase):
    def test_a_selected_candidate_has_why_open_and_no_why_not_open(self):
        explanation = CandidateExplanation(
            candidate_id="c1", why_open="ownership quality strong, IV attractive", why_not_open=None,
            why_this_contract="best break-even/tail trade-off among the enumerated strikes",
            why_not_second_best="second-best candidate had lower return per capital day",
        )
        self.assertIsNotNone(explanation.why_open)
        self.assertIsNone(explanation.why_not_open)

    def test_a_rejected_candidate_has_why_not_open_and_no_why_open(self):
        explanation = CandidateExplanation(
            candidate_id="c2", why_open=None, why_not_open="spread too wide at decision time",
            why_this_contract="would have been the richest premium but failed execution quality",
            why_not_second_best=None,
        )
        self.assertIsNone(explanation.why_open)
        self.assertIsNotNone(explanation.why_not_open)


class StrategyExplanationTests(unittest.TestCase):
    def test_reuses_branch_status_directly_not_a_duplicate_vocabulary(self):
        explanation = StrategyExplanation(branch="THETA_CONVENTIONAL", status=BranchStatus.RESEARCH_ONLY, status_reason="not yet promotion-eligible")
        self.assertEqual(explanation.status, BranchStatus.RESEARCH_ONLY)


class PositionExplanationTests(unittest.TestCase):
    def test_carries_every_alternative_not_only_the_chosen_action(self):
        alt1 = unknown_distribution("v1", ThetaStrategyAction.HOLD)
        alt2 = unknown_distribution("v1", ThetaStrategyAction.ROLL)
        explanation = PositionExplanation(
            position_label="AAPL CSP", chosen_action=ThetaStrategyAction.CLOSE_FULL,
            chosen_action_reason="remaining reward does not compensate for risk/capital usage",
            alternatives_considered=(alt1, alt2),
        )
        self.assertEqual(len(explanation.alternatives_considered), 2)


class PerformanceExplanationTests(unittest.TestCase):
    def test_every_field_can_be_unknown_never_forced_to_zero(self):
        explanation = PerformanceExplanation(
            whole_chain_net_pnl=None, managed_episode_net_pnl=None, return_on_secured_capital=None,
            return_per_capital_day=None, expected_shortfall=None, max_drawdown_pct=None,
            assignment_burden=None, recovery_duration_days=None, execution_degradation=None,
        )
        self.assertIsNone(explanation.whole_chain_net_pnl)


class UncalibratedConfidenceGuardTests(unittest.TestCase):
    def test_a_known_probability_without_calibration_confirmation_is_blocked(self):
        from research.action_value_distribution import OutcomeDistribution

        distribution = OutcomeDistribution(
            distribution_version="v1", action=ThetaStrategyAction.HOLD, expected_pnl=10.0, median_pnl=9.0,
            p25_pnl=-5.0, p5_pnl=-20.0, expected_shortfall=-25.0, probability_positive=0.93,
            expected_capital_days=100.0, assignment_probability=0.1, expected_recovery_duration_days=15.0,
            execution_cost=1.0, uncertainty=2.0,
        )
        violation = validate_no_uncalibrated_confidence(distribution, calibration_confirmed=False)
        self.assertIsNotNone(violation)
        self.assertIn("UNCALIBRATED_CONFIDENCE_BLOCKED", violation)

    def test_a_known_probability_with_calibration_confirmed_passes(self):
        from research.action_value_distribution import OutcomeDistribution

        distribution = OutcomeDistribution(
            distribution_version="v1", action=ThetaStrategyAction.HOLD, expected_pnl=10.0, median_pnl=9.0,
            p25_pnl=-5.0, p5_pnl=-20.0, expected_shortfall=-25.0, probability_positive=0.93,
            expected_capital_days=100.0, assignment_probability=0.1, expected_recovery_duration_days=15.0,
            execution_cost=1.0, uncertainty=2.0,
        )
        violation = validate_no_uncalibrated_confidence(distribution, calibration_confirmed=True)
        self.assertIsNone(violation)

    def test_an_unknown_probability_never_triggers_the_guard(self):
        distribution = unknown_distribution("v1", ThetaStrategyAction.HOLD)
        violation = validate_no_uncalibrated_confidence(distribution, calibration_confirmed=False)
        self.assertIsNone(violation)


class ActionCoverageTests(unittest.TestCase):
    def test_all_twelve_required_position_actions_are_named(self):
        self.assertEqual(len(REQUIRED_POSITION_EXPLANATION_ACTIONS), 12)

    def test_full_coverage_reports_nothing_missing(self):
        self.assertEqual(missing_position_explanation_actions(REQUIRED_POSITION_EXPLANATION_ACTIONS), [])

    def test_partial_coverage_names_the_exact_missing_actions(self):
        covered = tuple(a for a in REQUIRED_POSITION_EXPLANATION_ACTIONS if a != ThetaStrategyAction.ROLL_CC)
        missing = missing_position_explanation_actions(covered)
        self.assertEqual(missing, [ThetaStrategyAction.ROLL_CC])

    def test_required_actions_reuse_the_canonical_vocabulary(self):
        for action in REQUIRED_POSITION_EXPLANATION_ACTIONS:
            self.assertIsInstance(action, ThetaStrategyAction)


class ExplanationConsistencyTests(unittest.TestCase):
    """No LLM-generated explanation may invent a reason, probability, EV,
    blocker, or threshold the decision never used."""

    def test_an_explanation_derived_entirely_from_decision_fields_is_consistent(self):
        decision = {"ev_net": None, "hard_blockers": ["SPREAD_TOO_WIDE"], "iv_rank": 0.5}
        explanation = {"hard_blockers": ["SPREAD_TOO_WIDE"], "iv_rank": 0.5}
        report = validate_explanation_consistency(explanation, decision)
        self.assertTrue(report.consistent)

    def test_an_invented_probability_is_flagged(self):
        decision = {"ev_net": None}
        explanation = {"ev_net": None, "probability_of_profit": 0.93}
        report = validate_explanation_consistency(explanation, decision)
        self.assertFalse(report.consistent)
        self.assertIn("probability_of_profit", report.invented_fields)

    def test_an_invented_blocker_is_flagged(self):
        report = validate_explanation_consistency({"hard_blockers": ["MADE_UP"]}, {})
        self.assertFalse(report.consistent)

    def test_a_value_contradicting_the_decision_is_flagged(self):
        report = validate_explanation_consistency({"iv_rank": 0.9}, {"iv_rank": 0.5})
        self.assertFalse(report.consistent)
        self.assertIn("iv_rank", report.invented_fields)
        self.assertTrue(any("CONTRADICTS" in r for r in report.reasons))


class R5ExitCheckTests(unittest.TestCase):
    def _check(self, **overrides):
        fields = {name: True for name in R5ExitCheck.__dataclass_fields__}
        fields.update(overrides)
        return R5ExitCheck(**fields)

    def test_all_criteria_satisfied_is_pass(self):
        self.assertEqual(r5_quant_explanation_contract(self._check()), "PASS")

    def test_any_unmet_criterion_is_fail(self):
        for name in R5ExitCheck.__dataclass_fields__:
            self.assertEqual(r5_quant_explanation_contract(self._check(**{name: False})), "FAIL", f"{name}=False must FAIL")


if __name__ == "__main__":
    unittest.main()
