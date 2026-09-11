"""Tests for bots/theta/quant/research/action_value_distribution.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.action_value_distribution import OutcomeDistribution, unknown_distribution  # noqa: E402
from research.candidate_actions import CandidateAction  # noqa: E402


class UnknownDistributionTests(unittest.TestCase):
    def test_every_field_is_none(self):
        dist = unknown_distribution("v1", CandidateAction.HOLD)
        self.assertIsNone(dist.expected_pnl)
        self.assertIsNone(dist.median_pnl)
        self.assertIsNone(dist.p25_pnl)
        self.assertIsNone(dist.p5_pnl)
        self.assertIsNone(dist.expected_shortfall)
        self.assertIsNone(dist.probability_positive)
        self.assertIsNone(dist.assignment_probability)

    def test_is_fully_known_is_false_for_an_unknown_distribution(self):
        dist = unknown_distribution("v1", CandidateAction.HOLD)
        self.assertFalse(dist.is_fully_known())

    def test_carries_the_action_and_version(self):
        dist = unknown_distribution("v2", CandidateAction.ROLL)
        self.assertEqual(dist.action, CandidateAction.ROLL)
        self.assertEqual(dist.distribution_version, "v2")


class IsFullyKnownTests(unittest.TestCase):
    def test_a_fully_populated_distribution_is_fully_known(self):
        dist = OutcomeDistribution(
            distribution_version="v1", action=CandidateAction.CLOSE,
            expected_pnl=10.0, median_pnl=9.0, p25_pnl=-5.0, p5_pnl=-20.0,
            expected_shortfall=-25.0, probability_positive=0.6, expected_capital_days=100.0,
            assignment_probability=0.1, expected_recovery_duration_days=15.0,
            execution_cost=1.0, uncertainty=2.0,
        )
        self.assertTrue(dist.is_fully_known())

    def test_a_single_missing_field_makes_it_not_fully_known(self):
        dist = OutcomeDistribution(
            distribution_version="v1", action=CandidateAction.CLOSE,
            expected_pnl=10.0, median_pnl=9.0, p25_pnl=-5.0, p5_pnl=-20.0,
            expected_shortfall=-25.0, probability_positive=0.6, expected_capital_days=100.0,
            assignment_probability=0.1, expected_recovery_duration_days=15.0,
            execution_cost=1.0, uncertainty=None,  # the one missing field
        )
        self.assertFalse(dist.is_fully_known())


if __name__ == "__main__":
    unittest.main()
