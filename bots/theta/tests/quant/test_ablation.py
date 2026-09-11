"""Tests for bots/theta/quant/research/ablation.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.ablation import (  # noqa: E402
    CURRENT_FEATURE_FAMILY_STATUS,
    AblationResult,
    FeatureFamily,
    FeatureFamilyStatus,
    classify_ablation_result,
    welch_mean_difference,
)


class FeatureFamilyStatusTests(unittest.TestCase):
    def test_every_requested_feature_family_has_an_explicit_status(self):
        required_families = [
            FeatureFamily.OWNERSHIP, FeatureFamily.EVENT, FeatureFamily.MACRO, FeatureFamily.IV,
            FeatureFamily.IV_RV, FeatureFamily.SKEW, FeatureFamily.TERM_STRUCTURE, FeatureFamily.GEX,
            FeatureFamily.FLOW, FeatureFamily.TECHNICAL, FeatureFamily.TRADER_DNA, FeatureFamily.EXECUTION,
        ]
        for family in required_families:
            self.assertIn(family, CURRENT_FEATURE_FAMILY_STATUS)

    def test_gex_and_flow_are_honestly_not_implemented_never_assumed_available(self):
        self.assertEqual(CURRENT_FEATURE_FAMILY_STATUS[FeatureFamily.GEX], FeatureFamilyStatus.NOT_IMPLEMENTED)
        self.assertEqual(CURRENT_FEATURE_FAMILY_STATUS[FeatureFamily.FLOW], FeatureFamilyStatus.NOT_IMPLEMENTED)

    def test_ownership_and_execution_are_available_matching_real_wired_models(self):
        self.assertEqual(CURRENT_FEATURE_FAMILY_STATUS[FeatureFamily.OWNERSHIP], FeatureFamilyStatus.AVAILABLE)
        self.assertEqual(CURRENT_FEATURE_FAMILY_STATUS[FeatureFamily.EXECUTION], FeatureFamilyStatus.AVAILABLE)


class WelchMeanDifferenceTests(unittest.TestCase):
    def test_computes_a_positive_delta_when_treatment_outperforms(self):
        baseline = [10.0, 12.0, 11.0, 9.0, 10.0]
        treatment = [20.0, 22.0, 21.0, 19.0, 20.0]
        delta, se = welch_mean_difference(baseline, treatment)
        self.assertAlmostEqual(delta, 10.0)
        self.assertGreater(se, 0)

    def test_returns_none_none_for_an_undersized_sample(self):
        delta, se = welch_mean_difference([1.0], [1.0, 2.0, 3.0])
        self.assertIsNone(delta)
        self.assertIsNone(se)


class ClassifyAblationResultTests(unittest.TestCase):
    def test_a_clear_positive_effect_improves(self):
        result, reasons = classify_ablation_result(
            ev_delta=50.0, standard_error=5.0, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.IMPROVES)
        self.assertTrue(len(reasons) > 0)

    def test_a_clear_negative_effect_degrades(self):
        result, _ = classify_ablation_result(
            ev_delta=-50.0, standard_error=5.0, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.DEGRADES)

    def test_a_tight_ci_around_zero_is_neutral(self):
        result, _ = classify_ablation_result(
            ev_delta=0.5, standard_error=1.0, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.NEUTRAL)

    def test_a_wide_ci_straddling_zero_is_inconclusive_not_neutral(self):
        result, _ = classify_ablation_result(
            ev_delta=5.0, standard_error=20.0, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.INCONCLUSIVE)

    def test_a_statistically_significant_but_economically_trivial_effect_is_neutral_not_improves(self):
        # CI excludes zero (tight, low SE) but the point estimate itself
        # is below the meaningful effect size -- real, but not decision-relevant.
        result, reasons = classify_ablation_result(
            ev_delta=2.0, standard_error=0.5, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.NEUTRAL)
        self.assertTrue(any("economically trivial" in r for r in reasons))

    def test_insufficient_independent_n_is_always_inconclusive_regardless_of_point_estimate(self):
        result, reasons = classify_ablation_result(
            ev_delta=1000.0, standard_error=1.0, meaningful_effect_size=10.0, min_independent_n=300, independent_chain_n=50,
        )
        self.assertEqual(result, AblationResult.INCONCLUSIVE)
        self.assertTrue(any("independent_chain_n" in r for r in reasons))

    def test_missing_ev_delta_or_standard_error_is_inconclusive(self):
        result, _ = classify_ablation_result(
            ev_delta=None, standard_error=None, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.INCONCLUSIVE)

    def test_non_positive_standard_error_is_inconclusive_never_a_division_error(self):
        result, _ = classify_ablation_result(
            ev_delta=10.0, standard_error=0.0, meaningful_effect_size=10.0, min_independent_n=30, independent_chain_n=100,
        )
        self.assertEqual(result, AblationResult.INCONCLUSIVE)


if __name__ == "__main__":
    unittest.main()
