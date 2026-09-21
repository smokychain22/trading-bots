"""Tests for bots/theta/quant/research/severe_drawdown_tail_recommendation.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.severe_drawdown_tail_recommendation import (  # noqa: E402
    MIN_OOS_N_FOR_RECOMMENDATION,
    ApproachEvidence,
    recommend_tail_approach,
)


class SevereDrawdownTailRecommendationTest(unittest.TestCase):
    def test_no_evidence_supplied_is_insufficient_never_a_default_pick(self):
        result = recommend_tail_approach([])
        self.assertEqual(result.recommendation, "INSUFFICIENT_EMPIRICAL_EVIDENCE")
        self.assertEqual(result.evaluated_approaches, ())

    def test_no_approach_meeting_minimum_n_is_insufficient(self):
        evidence = [
            ApproachEvidence(approach="COMMON_DRAWDOWN_CONDITIONAL_MODEL", oos_n=10, oos_calibration_error=0.01, oos_stability_score=0.01),
        ]
        result = recommend_tail_approach(evidence)
        self.assertEqual(result.recommendation, "INSUFFICIENT_EMPIRICAL_EVIDENCE")

    def test_an_approach_with_unmeasured_calibration_is_excluded_never_treated_as_zero_error(self):
        evidence = [
            ApproachEvidence(approach="COMMON_DRAWDOWN_CONDITIONAL_MODEL", oos_n=1000, oos_calibration_error=None, oos_stability_score=None),
        ]
        result = recommend_tail_approach(evidence)
        self.assertEqual(result.recommendation, "INSUFFICIENT_EMPIRICAL_EVIDENCE")

    def test_picks_the_lowest_oos_calibration_error_among_eligible_approaches(self):
        evidence = [
            ApproachEvidence(approach="COMMON_DRAWDOWN_CONDITIONAL_MODEL", oos_n=MIN_OOS_N_FOR_RECOMMENDATION, oos_calibration_error=0.08, oos_stability_score=0.02),
            ApproachEvidence(approach="VOLATILITY_NORMALIZED_CONDITIONAL_MODEL", oos_n=MIN_OOS_N_FOR_RECOMMENDATION, oos_calibration_error=0.03, oos_stability_score=0.05),
            ApproachEvidence(approach="CONTINUOUS_CONDITIONAL_TAIL_DISTRIBUTION", oos_n=MIN_OOS_N_FOR_RECOMMENDATION, oos_calibration_error=0.03, oos_stability_score=0.10),
        ]
        result = recommend_tail_approach(evidence)
        self.assertEqual(result.recommendation, "VOLATILITY_NORMALIZED_CONDITIONAL_MODEL")  # ties broken by stability
        self.assertEqual(len(result.evaluated_approaches), 3)

    def test_below_minimum_n_approaches_are_excluded_but_do_not_block_an_eligible_one(self):
        evidence = [
            ApproachEvidence(approach="COMMON_DRAWDOWN_CONDITIONAL_MODEL", oos_n=5, oos_calibration_error=0.001, oos_stability_score=0.001),
            ApproachEvidence(approach="CONTINUOUS_CONDITIONAL_TAIL_DISTRIBUTION", oos_n=MIN_OOS_N_FOR_RECOMMENDATION, oos_calibration_error=0.10, oos_stability_score=0.10),
        ]
        result = recommend_tail_approach(evidence)
        self.assertEqual(result.recommendation, "CONTINUOUS_CONDITIONAL_TAIL_DISTRIBUTION")


if __name__ == "__main__":
    unittest.main()
