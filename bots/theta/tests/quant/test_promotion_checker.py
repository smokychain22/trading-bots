"""Tests for bots/theta/quant/research/promotion_checker.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.promotion_checker import (  # noqa: E402
    PromotionCheckInputs,
    PromotionResult,
    evaluate_promotion,
)


def _passing_inputs(**overrides):
    defaults = dict(
        used_point_in_time_joins=True,
        leakage_violations=[],
        only_resolved_chains_used=True,
        execution_model_is_direction_aware=True,
        final_oos_touched_exactly_once=True,
        training_dataset_hash="train-hash-1",
        evaluation_dataset_hash="eval-hash-1",
        model_version="theta-q-v1",
        independent_chain_n=500,
        min_independent_chain_n=300,
        deflated_sharpe_ratio=0.97,
        min_acceptable_dsr=0.95,
        probability_of_backtest_overfitting=0.1,
        max_acceptable_pbo=0.3,
        final_oos_ci_excludes_zero=True,
        calibration_acceptable=True,
        oos_ev_net=25.0,
        es_regression_pct=0.02,
        max_acceptable_es_regression_pct=0.10,
        drawdown_regression_pct=0.01,
        max_acceptable_drawdown_regression_pct=0.10,
        catastrophic_subgroup_collapse=False,
        ablation_result="IMPROVES",
        regime_stability_verified=True,
        edge_survives_realistic_execution=True,
    )
    defaults.update(overrides)
    return PromotionCheckInputs(**defaults)


class StructuralFailureTests(unittest.TestCase):
    def test_non_point_in_time_joins_fail_structurally(self):
        result = evaluate_promotion(_passing_inputs(used_point_in_time_joins=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_leakage_violations_fail_structurally(self):
        result = evaluate_promotion(_passing_inputs(leakage_violations=["fold 0: chain-1 in two roles"]))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_unresolved_chains_in_training_fail_structurally(self):
        result = evaluate_promotion(_passing_inputs(only_resolved_chains_used=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_midpoint_based_execution_model_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(execution_model_is_direction_aware=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_final_oos_used_for_selection_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(final_oos_touched_exactly_once=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_missing_dataset_hashes_fail_structurally(self):
        result = evaluate_promotion(_passing_inputs(training_dataset_hash=None))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_identical_train_and_eval_hashes_fail_structurally(self):
        result = evaluate_promotion(_passing_inputs(evaluation_dataset_hash="train-hash-1"))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_missing_model_version_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(model_version=None))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_invalid_roll_accounting_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(roll_accounting_verified=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_premium_based_fake_return_denominator_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(return_denominator_verified=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_fabricated_fill_probability_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(fill_probability_is_fabricated=True))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_missing_feature_provenance_fails_structurally(self):
        result = evaluate_promotion(_passing_inputs(feature_provenance_recorded=False))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)

    def test_structural_failure_takes_precedence_over_a_great_looking_economic_result(self):
        # Even with a huge EV and perfect statistics, a leakage violation
        # must still win -- structural checks are unconditional.
        result = evaluate_promotion(_passing_inputs(leakage_violations=["leak"], oos_ev_net=1_000_000.0))
        self.assertEqual(result.result, PromotionResult.STRUCTURAL_FAILURE)


class DataInsufficientTests(unittest.TestCase):
    def test_below_minimum_independent_n_is_data_insufficient(self):
        result = evaluate_promotion(_passing_inputs(independent_chain_n=50, min_independent_chain_n=300))
        self.assertEqual(result.result, PromotionResult.DATA_INSUFFICIENT)

    def test_a_zero_or_negative_minimum_threshold_is_rejected_as_a_caller_error(self):
        with self.assertRaises(ValueError):
            evaluate_promotion(_passing_inputs(min_independent_chain_n=0))


class StatisticalFailureTests(unittest.TestCase):
    def test_missing_dsr_is_statistical_failure(self):
        result = evaluate_promotion(_passing_inputs(deflated_sharpe_ratio=None))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_dsr_below_the_required_minimum_is_statistical_failure(self):
        result = evaluate_promotion(_passing_inputs(deflated_sharpe_ratio=0.6, min_acceptable_dsr=0.95))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_pbo_above_the_acceptable_maximum_is_statistical_failure(self):
        result = evaluate_promotion(_passing_inputs(probability_of_backtest_overfitting=0.6, max_acceptable_pbo=0.3))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_final_oos_ci_not_excluding_zero_is_statistical_failure(self):
        result = evaluate_promotion(_passing_inputs(final_oos_ci_excludes_zero=False))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_unacceptable_calibration_is_statistical_failure(self):
        result = evaluate_promotion(_passing_inputs(calibration_acceptable=False))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_pbo_supplied_without_its_threshold_is_a_caller_error(self):
        with self.assertRaises(ValueError):
            evaluate_promotion(_passing_inputs(probability_of_backtest_overfitting=0.2, max_acceptable_pbo=None))

    def test_a_neutral_ablation_result_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(ablation_result="NEUTRAL"))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_a_degrades_ablation_result_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(ablation_result="DEGRADES"))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_an_inconclusive_ablation_result_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(ablation_result="INCONCLUSIVE"))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_a_missing_ablation_result_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(ablation_result=None))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_unverified_regime_stability_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(regime_stability_verified=None))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)

    def test_inconsistent_regime_stability_blocks_promotion(self):
        result = evaluate_promotion(_passing_inputs(regime_stability_verified=False))
        self.assertEqual(result.result, PromotionResult.STATISTICAL_FAILURE)


class EconomicFailureTests(unittest.TestCase):
    def test_non_positive_oos_ev_is_economic_failure(self):
        result = evaluate_promotion(_passing_inputs(oos_ev_net=-5.0))
        self.assertEqual(result.result, PromotionResult.ECONOMIC_FAILURE)

    def test_missing_oos_ev_is_economic_failure_never_assumed_positive(self):
        result = evaluate_promotion(_passing_inputs(oos_ev_net=None))
        self.assertEqual(result.result, PromotionResult.ECONOMIC_FAILURE)


class RiskFailureTests(unittest.TestCase):
    def test_catastrophic_subgroup_collapse_is_risk_failure(self):
        result = evaluate_promotion(_passing_inputs(catastrophic_subgroup_collapse=True))
        self.assertEqual(result.result, PromotionResult.RISK_FAILURE)

    def test_es_regression_beyond_the_acceptable_maximum_is_risk_failure(self):
        result = evaluate_promotion(_passing_inputs(es_regression_pct=0.5, max_acceptable_es_regression_pct=0.10))
        self.assertEqual(result.result, PromotionResult.RISK_FAILURE)

    def test_drawdown_regression_beyond_the_acceptable_maximum_is_risk_failure(self):
        result = evaluate_promotion(_passing_inputs(drawdown_regression_pct=0.5, max_acceptable_drawdown_regression_pct=0.10))
        self.assertEqual(result.result, PromotionResult.RISK_FAILURE)


class ExecutionFailureTests(unittest.TestCase):
    def test_edge_not_surviving_realistic_execution_is_execution_failure(self):
        result = evaluate_promotion(_passing_inputs(edge_survives_realistic_execution=False))
        self.assertEqual(result.result, PromotionResult.EXECUTION_FAILURE)

    def test_unknown_execution_realism_is_execution_failure_never_assumed_true(self):
        result = evaluate_promotion(_passing_inputs(edge_survives_realistic_execution=None))
        self.assertEqual(result.result, PromotionResult.EXECUTION_FAILURE)

    def test_execution_failure_is_distinct_from_risk_failure(self):
        # A bad execution realism result must not be misreported as a
        # tail/ES/drawdown risk failure -- it is its own category.
        result = evaluate_promotion(_passing_inputs(edge_survives_realistic_execution=False))
        self.assertNotEqual(result.result, PromotionResult.RISK_FAILURE)


class PromotionEligibleResearchTests(unittest.TestCase):
    def test_a_fully_passing_evaluation_is_promotion_eligible_research(self):
        result = evaluate_promotion(_passing_inputs())
        self.assertEqual(result.result, PromotionResult.PROMOTION_ELIGIBLE_RESEARCH)

    def test_promotion_eligible_research_never_claims_production_activation(self):
        result = evaluate_promotion(_passing_inputs())
        self.assertTrue(any("Codex" in r for r in result.reasons))


if __name__ == "__main__":
    unittest.main()
