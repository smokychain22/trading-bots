"""Tests for bots/theta/quant/research/champion_challenger.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.strategy_router import StrategyFamily  # noqa: E402
from research.champion_challenger import (  # noqa: E402
    BranchPromotionRecord,
    BranchStatus,
    champions_and_challengers,
    determine_branch_status,
    route_champion_challenger,
)
from research.promotion_checker import PromotionResult  # noqa: E402


class DetermineBranchStatusTests(unittest.TestCase):
    def test_eligible_and_activated_is_champion(self):
        record = BranchPromotionRecord(StrategyFamily.THETA_Q, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, False, True)
        self.assertEqual(determine_branch_status(record), BranchStatus.CHAMPION)

    def test_eligible_but_not_yet_activated_is_challenger(self):
        record = BranchPromotionRecord(StrategyFamily.THETA_H, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, False, False)
        self.assertEqual(determine_branch_status(record), BranchStatus.CHALLENGER)

    def test_never_validated_is_research_only(self):
        record = BranchPromotionRecord(StrategyFamily.THETA_D, PromotionResult.DATA_INSUFFICIENT, False, False)
        self.assertEqual(determine_branch_status(record), BranchStatus.RESEARCH_ONLY)

    def test_a_regression_from_prior_champion_status_is_retired_not_research_only(self):
        record = BranchPromotionRecord(StrategyFamily.THETA_C, PromotionResult.ECONOMIC_FAILURE, True, True)
        self.assertEqual(determine_branch_status(record), BranchStatus.RETIRED)

    def test_a_health_drift_on_a_previously_championed_branch_is_degraded(self):
        record = BranchPromotionRecord(
            StrategyFamily.THETA_Q, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, True, True,
            health_drift_detected=True, severe_health_drift=False,
        )
        self.assertEqual(determine_branch_status(record), BranchStatus.DEGRADED)

    def test_severe_health_drift_on_a_previously_championed_branch_is_hold_only(self):
        record = BranchPromotionRecord(
            StrategyFamily.THETA_Q, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, True, True,
            health_drift_detected=True, severe_health_drift=True,
        )
        self.assertEqual(determine_branch_status(record), BranchStatus.HOLD_ONLY)

    def test_health_drift_on_a_branch_never_previously_championed_does_not_trigger_degraded(self):
        # Drift-based de-rating only applies to a branch that WAS
        # champion/challenger -- a brand-new, never-activated branch has
        # nothing to "drift" from.
        record = BranchPromotionRecord(
            StrategyFamily.THETA_D, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, False, False,
            health_drift_detected=True, severe_health_drift=False,
        )
        self.assertEqual(determine_branch_status(record), BranchStatus.CHALLENGER)


class RouteChampionChallengerTests(unittest.TestCase):
    def test_each_family_status_is_independent_of_every_other_family(self):
        records = {
            StrategyFamily.THETA_Q: BranchPromotionRecord(StrategyFamily.THETA_Q, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH, False, True),
            StrategyFamily.THETA_H: BranchPromotionRecord(StrategyFamily.THETA_H, PromotionResult.STATISTICAL_FAILURE, False, False),
        }
        statuses = route_champion_challenger(records)
        # THETA_H's failure must not affect THETA_Q's champion status --
        # no branch is activated/deactivated because of another branch.
        self.assertEqual(statuses[StrategyFamily.THETA_Q], BranchStatus.CHAMPION)
        self.assertEqual(statuses[StrategyFamily.THETA_H], BranchStatus.RESEARCH_ONLY)

    def test_champions_and_challengers_excludes_research_only_hold_only_and_retired(self):
        statuses = {
            StrategyFamily.THETA_Q: BranchStatus.CHAMPION,
            StrategyFamily.THETA_H: BranchStatus.CHALLENGER,
            StrategyFamily.THETA_D: BranchStatus.RESEARCH_ONLY,
            StrategyFamily.THETA_R: BranchStatus.RETIRED,
            StrategyFamily.THETA_A: BranchStatus.HOLD_ONLY,
        }
        routable = champions_and_challengers(statuses)
        self.assertIn(StrategyFamily.THETA_Q, routable)
        self.assertIn(StrategyFamily.THETA_H, routable)
        self.assertNotIn(StrategyFamily.THETA_D, routable)
        self.assertNotIn(StrategyFamily.THETA_R, routable)
        self.assertNotIn(StrategyFamily.THETA_A, routable)

    def test_champions_and_challengers_includes_degraded(self):
        statuses = {StrategyFamily.THETA_Q: BranchStatus.DEGRADED}
        routable = champions_and_challengers(statuses)
        self.assertIn(StrategyFamily.THETA_Q, routable)


if __name__ == "__main__":
    unittest.main()
