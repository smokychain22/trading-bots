"""Tests for bots/theta/quant/research/loss_taxonomy.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.loss_taxonomy import (  # noqa: E402
    AttributionWithoutEvidenceError,
    DecisionQuality,
    FailureCategory,
    attribute_failure,
    classify_decision_quality,
    loss_requires_no_policy_change,
    unattributed,
)


class AttributionRequiresEvidenceTests(unittest.TestCase):
    def test_attributing_a_named_category_without_evidence_raises(self):
        with self.assertRaises(AttributionWithoutEvidenceError):
            attribute_failure(FailureCategory.BAD_CONTRACT_SELECTION, evidence=[])

    def test_attributing_with_concrete_evidence_succeeds(self):
        attribution = attribute_failure(
            FailureCategory.EXECUTION_SLIPPAGE,
            evidence=["quote_age_ms=48000 exceeded the 5000ms policy limit at decision time"],
            confidence="MEDIUM", requires_policy_change=True,
        )
        self.assertEqual(attribution.category, FailureCategory.EXECUTION_SLIPPAGE)
        self.assertEqual(len(attribution.evidence), 1)
        self.assertTrue(attribution.requires_policy_change)

    def test_unattributed_normal_variance_needs_no_evidence_list(self):
        attribution = unattributed()
        self.assertEqual(attribution.category, FailureCategory.UNATTRIBUTED_NORMAL_VARIANCE)
        self.assertFalse(attribution.requires_policy_change)

    def test_confidence_is_never_fabricated_when_not_supplied(self):
        attribution = attribute_failure(
            FailureCategory.BAD_ROLL, evidence=["new leg EV was negative at roll decision time"],
        )
        self.assertIsNone(attribution.confidence)


class DecisionQualityGridTests(unittest.TestCase):
    def test_good_process_and_positive_outcome(self):
        self.assertEqual(
            classify_decision_quality(True, True), DecisionQuality.GOOD_PROCESS_GOOD_OUTCOME)

    def test_good_process_and_negative_outcome_is_normal_variance_not_a_mistake(self):
        result = classify_decision_quality(True, False)
        self.assertEqual(result, DecisionQuality.GOOD_PROCESS_BAD_OUTCOME)
        self.assertTrue(loss_requires_no_policy_change(result))

    def test_bad_process_and_positive_outcome_is_not_vindicated_by_the_win(self):
        result = classify_decision_quality(False, True)
        self.assertEqual(result, DecisionQuality.BAD_PROCESS_LUCKY_OUTCOME)
        self.assertFalse(loss_requires_no_policy_change(result))

    def test_bad_process_and_negative_outcome(self):
        self.assertEqual(
            classify_decision_quality(False, False), DecisionQuality.BAD_PROCESS_BAD_OUTCOME)

    def test_unknown_process_or_outcome_cannot_be_classified(self):
        self.assertIsNone(classify_decision_quality(None, True))
        self.assertIsNone(classify_decision_quality(True, None))
        self.assertIsNone(classify_decision_quality(None, None))


class FailureCategoryCoverageTests(unittest.TestCase):
    def test_taxonomy_covers_every_directive_named_category(self):
        required = {
            "BAD_UNDERLYING_SELECTION", "DIRECTIONAL_REGIME_ERROR", "VOLATILITY_EXPANSION",
            "GAP_EVENT_SHOCK", "LIQUIDITY_FAILURE", "BAD_CONTRACT_SELECTION", "OVER_SIZING",
            "CORRELATION_CONCENTRATION", "EXECUTION_SLIPPAGE", "BAD_MANAGEMENT_TIMING",
            "BAD_ROLL", "ASSIGNMENT_OUTCOME", "BAD_RECOVERY_POLICY", "BAD_CC_POLICY",
            "PROVIDER_FAILURE", "LIFECYCLE_BROKER_MISMATCH", "MODEL_CALIBRATION_FAILURE",
        }
        present = {member.value for member in FailureCategory}
        self.assertTrue(required.issubset(present))

    def test_over_strict_and_under_strict_gate_are_distinct_categories(self):
        self.assertNotEqual(FailureCategory.OVER_STRICT_GATE, FailureCategory.UNDER_STRICT_GATE)


if __name__ == "__main__":
    unittest.main()
