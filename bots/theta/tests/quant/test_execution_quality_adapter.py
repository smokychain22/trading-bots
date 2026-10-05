"""Tests for bots/theta/quant/features/execution_quality_adapter.py (work
package 19): the real, existing models/execution_quality.py's
assess_execution_quality(), converted into the canonical FeatureResult
contract -- never reimplemented.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState, FeatureTruthClass  # noqa: E402
from features.execution_quality_adapter import execution_quality_assessment_to_result  # noqa: E402
from models.execution_quality import (  # noqa: E402
    ExecutionQualityInputs, ExecutionQualityPolicy, PositionIntent, UtilityEvidenceState,
    assess_execution_quality,
)


def _policy(**overrides) -> ExecutionQualityPolicy:
    defaults = dict(
        policy_version="TEST-EXEC-1", max_acceptable_spread_pct=0.10, min_quote_size_for_full_confidence=20,
        max_quote_age_seconds=5.0, min_after_cost_utility_to_cross=0.0,
    )
    defaults.update(overrides)
    return ExecutionQualityPolicy(**defaults)


def _inputs(**overrides) -> ExecutionQualityInputs:
    defaults = dict(
        position_intent=PositionIntent.BUY_TO_OPEN, bid=0.55, ask=0.60, quote_size=50,
        quote_age_seconds=1.0, limit_price=0.58, pre_slippage_expected_utility=10.0,
        utility_evidence_state=UtilityEvidenceState.EMPIRICAL_ESTIMATE,
    )
    defaults.update(overrides)
    return ExecutionQualityInputs(**defaults)


class TestExecutionQualityAdapter(unittest.TestCase):
    def test_acceptable_assessment_converts_to_ok_modeled_research(self):
        assessment = assess_execution_quality(_policy(), _inputs())
        result = execution_quality_assessment_to_result(assessment, "SPY261016P00650000", "t", "t")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.truth_class, FeatureTruthClass.MODELED_RESEARCH)
        self.assertTrue(result.structured_value["acceptable"])

    def test_unknown_quote_converts_to_unknown_never_fabricated(self):
        assessment = assess_execution_quality(_policy(), _inputs(bid=None, ask=None))
        result = execution_quality_assessment_to_result(assessment, "SPY261016P00650000", "t", "t")
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)
        self.assertEqual(result.truth_class, FeatureTruthClass.UNKNOWN)

    def test_never_labeled_broker_actual(self):
        assessment = assess_execution_quality(_policy(), _inputs())
        result = execution_quality_assessment_to_result(assessment, "SPY261016P00650000", "t", "t")
        self.assertNotEqual(result.truth_class, FeatureTruthClass.MARKET_OBSERVED)

    def test_skip_recommendation_still_reaches_ok_state(self):
        assessment = assess_execution_quality(_policy(max_acceptable_spread_pct=0.05), _inputs(bid=0.40, ask=0.60))
        result = execution_quality_assessment_to_result(assessment, "SPY261016P00650000", "t", "t")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["recommendedAction"], "SKIP")


if __name__ == "__main__":
    unittest.main()
