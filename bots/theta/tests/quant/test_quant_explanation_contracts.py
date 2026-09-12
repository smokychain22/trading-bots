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
    CandidateExplanation,
    PerformanceExplanation,
    PositionExplanation,
    StrategyExplanation,
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


if __name__ == "__main__":
    unittest.main()
