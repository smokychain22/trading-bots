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
    paired_mean_difference,
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


class PairedMeanDifferenceTests(unittest.TestCase):
    """The statistic ablation.py must actually use: baseline and
    treatment are the SAME episodes re-scored with/without a feature, so
    per-episode common noise must cancel in the paired difference rather
    than inflating the standard error the way an unpaired (Welch) test
    would."""

    def test_computes_the_mean_of_the_paired_differences(self):
        baseline = [10.0, 12.0, 8.0, 15.0, 9.0]
        treatment = [20.0, 21.0, 19.0, 24.0, 18.0]  # treatment - baseline = [10, 9, 11, 9, 9]
        delta, se = paired_mean_difference(baseline, treatment)
        self.assertAlmostEqual(delta, 9.6)
        self.assertGreater(se, 0)

    def test_mismatched_lengths_return_none_none_never_a_silent_misalignment(self):
        delta, se = paired_mean_difference([1.0, 2.0, 3.0], [1.0, 2.0])
        self.assertIsNone(delta)
        self.assertIsNone(se)

    def test_returns_none_none_for_fewer_than_two_pairs(self):
        delta, se = paired_mean_difference([1.0], [2.0])
        self.assertIsNone(delta)
        self.assertIsNone(se)

    def test_paired_standard_error_is_smaller_than_unpaired_when_episodes_share_common_noise(self):
        # Same underlying per-episode noise present in BOTH arms (a
        # shared confound across baseline and treatment for each
        # episode), plus a small, consistent +2.0 treatment effect. The
        # paired test should cancel the shared noise and report a much
        # tighter standard error than Welch's unpaired test, which cannot
        # see that the noise is shared.
        common_noise = [5.0, -3.0, 8.0, -6.0, 2.0, -4.0]
        baseline = [10.0 + n for n in common_noise]
        treatment = [12.0 + n for n in common_noise]  # exactly +2.0 per episode, same noise
        paired_delta, paired_se = paired_mean_difference(baseline, treatment)
        welch_delta, welch_se = welch_mean_difference(baseline, treatment)
        self.assertAlmostEqual(paired_delta, 2.0)
        self.assertAlmostEqual(welch_delta, 2.0)
        self.assertLess(paired_se, welch_se)


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
