"""Tests for research/label_quality_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.label_quality_research import (  # noqa: E402
    LabelAmbiguityFlag,
    LabelQualityInputs,
    LabelQualityTier,
    assess_label_quality,
    training_weight_for_tier,
)


def _inputs(**overrides):
    defaults = dict(
        resolution_state="RESOLVED", completeness="COMPLETE", provenance="BROKER_ACTUAL",
        execution_model_class="BROKER_ACTUAL", exact_contract_id_present=True,
        observation_count=10, observation_count_expected_minimum=5, horizon_fully_observed=True,
        ambiguity_flags=(),
    )
    defaults.update(overrides)
    return LabelQualityInputs(**defaults)


class AssessLabelQualityTests(unittest.TestCase):
    def test_ideal_broker_actual_label_is_high(self):
        result = assess_label_quality(_inputs())
        self.assertEqual(result.tier, LabelQualityTier.HIGH)
        self.assertTrue(result.usable_for_training)
        self.assertEqual(result.reasons, [])

    def test_non_resolved_state_is_unusable(self):
        result = assess_label_quality(_inputs(resolution_state="PENDING"))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)
        self.assertFalse(result.usable_for_training)

    def test_hard_ambiguity_flag_forces_unusable_even_with_perfect_completeness(self):
        result = assess_label_quality(_inputs(ambiguity_flags=[LabelAmbiguityFlag.CORPORATE_ACTION_UNRESOLVED_HARD]))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)
        self.assertIn("CORPORATE_ACTION_UNRESOLVED_HARD", result.reasons)

    def test_invalid_completeness_is_unusable(self):
        result = assess_label_quality(_inputs(completeness="INVALID"))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)

    def test_partial_completeness_degrades_to_moderate(self):
        result = assess_label_quality(_inputs(completeness="PARTIAL"))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_modeled_research_provenance_degrades_from_high(self):
        result = assess_label_quality(_inputs(provenance="MODELED_RESEARCH", execution_model_class="MODELED_RESEARCH"))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_broker_actual_provenance_with_mismatched_execution_model_is_unusable(self):
        result = assess_label_quality(_inputs(provenance="BROKER_ACTUAL", execution_model_class="MARKET_MARK"))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)
        self.assertIn("BROKER_PROVENANCE_EXECUTION_MODEL_MISMATCH", result.reasons)

    def test_missing_exact_contract_identity_degrades_one_tier(self):
        result = assess_label_quality(_inputs(exact_contract_id_present=False))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_sparse_path_degrades_one_tier(self):
        result = assess_label_quality(_inputs(observation_count=1, observation_count_expected_minimum=5))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_incomplete_horizon_degrades_one_tier(self):
        result = assess_label_quality(_inputs(horizon_fully_observed=False))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_soft_flag_degrades_one_tier(self):
        result = assess_label_quality(_inputs(ambiguity_flags=[LabelAmbiguityFlag.THIN_QUOTE_SOFT]))
        self.assertEqual(result.tier, LabelQualityTier.MODERATE)

    def test_multiple_degradations_stack_but_never_exceed_unusable(self):
        result = assess_label_quality(_inputs(
            completeness="PARTIAL", exact_contract_id_present=False, horizon_fully_observed=False,
            ambiguity_flags=[LabelAmbiguityFlag.THIN_QUOTE_SOFT],
        ))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)
        self.assertFalse(result.usable_for_training)

    def test_unrecognized_provenance_is_unusable_not_guessed(self):
        result = assess_label_quality(_inputs(provenance="SOMETHING_NEW"))
        self.assertEqual(result.tier, LabelQualityTier.UNUSABLE)


class TrainingWeightForTierTests(unittest.TestCase):
    def test_unusable_always_returns_none_regardless_of_caller_weights(self):
        self.assertIsNone(training_weight_for_tier(LabelQualityTier.UNUSABLE, {LabelQualityTier.UNUSABLE: 0.5}))

    def test_missing_tier_in_caller_mapping_returns_none(self):
        self.assertIsNone(training_weight_for_tier(LabelQualityTier.LOW, {LabelQualityTier.HIGH: 1.0}))

    def test_valid_caller_supplied_weight_is_returned(self):
        self.assertEqual(training_weight_for_tier(LabelQualityTier.MODERATE, {LabelQualityTier.MODERATE: 0.6}), 0.6)

    def test_out_of_range_weight_returns_none(self):
        self.assertIsNone(training_weight_for_tier(LabelQualityTier.HIGH, {LabelQualityTier.HIGH: 1.5}))


if __name__ == "__main__":
    unittest.main()
