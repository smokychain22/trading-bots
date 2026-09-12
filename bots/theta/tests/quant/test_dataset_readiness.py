"""Tests for bots/theta/quant/research/dataset_readiness.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.dataset_contracts import CensoringState, EconomicEpisode, SubjectType, ThetaStrategyBranch  # noqa: E402
from research.dataset_readiness import (  # noqa: E402
    DatasetReadinessState,
    DependenceGroupKey,
    EvidenceSourceLabel,
    ExperimentConfig,
    ResearchPaperReadinessCheck,
    SufficiencyThresholds,
    assess_model_fit_sufficiency,
    build_dependence_groups,
    classify_dataset_readiness,
    effective_sample_size,
    research_ready_for_paper,
    run_empirical_program,
    slice_by_branch,
)


def _episode(episode_id, censoring_state, pnl=None):
    return EconomicEpisode(
        outcome_label_id=episode_id, subject_type=SubjectType.WHOLE_CHAIN, subject_id=f"chain-{episode_id}",
        label_available_at="2026-01-01T00:00:00+00:00", label_version="lv-1", censoring_state=censoring_state,
        whole_chain_net_pnl=pnl, managed_episode_pnl=pnl, return_on_secured_capital=None,
        return_per_capital_day=None, max_adverse_excursion=None, max_favorable_excursion=None,
        recovery_duration_days=None, realized_execution_cost=None, outcomes={}, provenance={}, content_hash="a" * 64,
    )


class SufficiencyTests(unittest.TestCase):
    def _thresholds(self, **overrides):
        defaults = dict(min_raw_n=100, min_independent_n=30, min_positive_outcomes=10,
                         min_negative_outcomes=10, min_branch_coverage=3, min_regime_coverage=2)
        defaults.update(overrides)
        return SufficiencyThresholds(**defaults)

    def test_a_fully_sufficient_dataset_is_eligible(self):
        report = assess_model_fit_sufficiency(200, 50, 20, 20, 3, 2, self._thresholds())
        self.assertTrue(report.eligible)
        self.assertEqual(report.reasons, [])

    def test_insufficient_independent_n_is_flagged_with_a_reason(self):
        report = assess_model_fit_sufficiency(200, 5, 20, 20, 3, 2, self._thresholds())
        self.assertFalse(report.eligible)
        self.assertTrue(any("independent_n" in r for r in report.reasons))

    def test_multiple_failing_dimensions_are_all_reported_not_just_the_first(self):
        report = assess_model_fit_sufficiency(10, 2, 0, 0, 0, 0, self._thresholds())
        self.assertFalse(report.eligible)
        self.assertGreaterEqual(len(report.reasons), 4)


class BranchSlicingTests(unittest.TestCase):
    def test_episodes_split_into_resolved_censored_invalidated_buckets(self):
        episodes = [
            _episode("e1", CensoringState.RESOLVED, 10.0),
            _episode("e2", CensoringState.RIGHT_CENSORED),
            _episode("e3", CensoringState.INVALIDATED),
        ]
        slices = slice_by_branch({ThetaStrategyBranch.THETA_CONVENTIONAL: episodes})
        s = slices[ThetaStrategyBranch.THETA_CONVENTIONAL]
        self.assertEqual(len(s.resolved_episodes), 1)
        self.assertEqual(len(s.censored_episodes), 1)
        self.assertEqual(len(s.invalidated_episodes), 1)

    def test_branches_are_never_mixed(self):
        conv = [_episode("e1", CensoringState.RESOLVED, 10.0)]
        recovery = [_episode("e2", CensoringState.RESOLVED, -5.0)]
        slices = slice_by_branch({
            ThetaStrategyBranch.THETA_CONVENTIONAL: conv,
            ThetaStrategyBranch.THETA_RECOVERY: recovery,
        })
        self.assertEqual(len(slices[ThetaStrategyBranch.THETA_CONVENTIONAL].resolved_episodes), 1)
        self.assertEqual(len(slices[ThetaStrategyBranch.THETA_RECOVERY].resolved_episodes), 1)
        self.assertNotEqual(
            slices[ThetaStrategyBranch.THETA_CONVENTIONAL].resolved_episodes[0].outcome_label_id,
            slices[ThetaStrategyBranch.THETA_RECOVERY].resolved_episodes[0].outcome_label_id,
        )


class DependenceGroupTests(unittest.TestCase):
    def test_correlated_rows_sharing_every_dimension_collapse_to_one_group(self):
        keys = [DependenceGroupKey("chain-1", None, "SPY", "2026-01-01", None) for _ in range(10)]
        self.assertEqual(effective_sample_size(keys), 1)

    def test_genuinely_distinct_rows_are_not_merged(self):
        keys = [DependenceGroupKey(f"chain-{i}", None, "SPY", "2026-01-01", None) for i in range(10)]
        self.assertEqual(effective_sample_size(keys), 10)

    def test_ten_thousand_correlated_decisions_is_not_n_equals_ten_thousand(self):
        keys = [DependenceGroupKey("chain-1", "ep-1", "SPY", "2026-03-15", "cluster-A") for _ in range(1000)]
        groups = build_dependence_groups(keys)
        self.assertEqual(len(groups), 1)
        self.assertNotEqual(effective_sample_size(keys), 1000)


class ReadinessStateMachineTests(unittest.TestCase):
    def test_no_export_is_dataset_absent(self):
        self.assertEqual(classify_dataset_readiness(None, None), DatasetReadinessState.DATASET_ABSENT)

    def test_export_present_but_no_sufficiency_assessed_is_descriptive_audit_only(self):
        self.assertEqual(classify_dataset_readiness("fake-export", None), DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY)

    def test_insufficient_sample_is_descriptive_audit_only(self):
        from research.dataset_readiness import SufficiencyReport

        report = SufficiencyReport(eligible=False, reasons=["raw_n too small"])
        self.assertEqual(classify_dataset_readiness("fake-export", report), DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY)

    def test_sufficient_sample_without_a_walk_forward_plan_is_model_fit_eligible_only(self):
        from research.dataset_readiness import SufficiencyReport

        report = SufficiencyReport(eligible=True, reasons=[])
        self.assertEqual(classify_dataset_readiness("fake-export", report), DatasetReadinessState.MODEL_FIT_ELIGIBLE)

    def test_valid_walk_forward_plan_without_untouched_oos_is_walk_forward_eligible(self):
        from research.dataset_readiness import SufficiencyReport

        report = SufficiencyReport(eligible=True, reasons=[])
        state = classify_dataset_readiness("fake-export", report, walk_forward_plan_valid=True)
        self.assertEqual(state, DatasetReadinessState.WALK_FORWARD_ELIGIBLE)

    def test_full_chain_reaches_oos_evaluation_eligible(self):
        from research.dataset_readiness import SufficiencyReport

        report = SufficiencyReport(eligible=True, reasons=[])
        state = classify_dataset_readiness("fake-export", report, walk_forward_plan_valid=True, final_oos_untouched=True)
        self.assertEqual(state, DatasetReadinessState.OOS_EVALUATION_ELIGIBLE)

    def test_final_oos_alone_cannot_skip_the_walk_forward_precondition(self):
        from research.dataset_readiness import SufficiencyReport

        report = SufficiencyReport(eligible=True, reasons=[])
        # walk_forward_plan_valid defaults to None/not-True -- final_oos_untouched=True alone must not skip ahead
        state = classify_dataset_readiness("fake-export", report, walk_forward_plan_valid=False, final_oos_untouched=True)
        self.assertEqual(state, DatasetReadinessState.MODEL_FIT_ELIGIBLE)


class RunEmpiricalProgramTests(unittest.TestCase):
    def _config(self):
        return ExperimentConfig(
            dataset_hash="h1", target_version="tv1", feature_version="fv1",
            strategy_branch=ThetaStrategyBranch.THETA_CONVENTIONAL, cost_model_version="cm1",
            split_definition="sd1", experiment_id="exp1", hypothesis_id="H-Q-01",
            evidence_source=EvidenceSourceLabel.HISTORICAL_REPLAY,
        )

    def test_no_dataset_refuses_every_experiment_class(self):
        result = run_empirical_program(None, self._config(), None)
        self.assertEqual(result.eligible_experiments, [])
        self.assertIn("MODEL_FIT", result.refused_experiments)

    def test_insufficient_data_permits_only_descriptive_audit(self):
        from research.dataset_readiness import SufficiencyReport

        result = run_empirical_program("fake-export", self._config(), SufficiencyReport(eligible=False, reasons=["too small"]))
        self.assertEqual(result.eligible_experiments, ["DESCRIPTIVE_AUDIT"])
        self.assertIn("MODEL_FIT", result.refused_experiments)

    def test_sufficient_data_produces_a_reproducibility_fingerprint(self):
        from research.dataset_readiness import SufficiencyReport

        result = run_empirical_program("fake-export", self._config(), SufficiencyReport(eligible=True, reasons=[]))
        self.assertIsNotNone(result.reproducibility_fingerprint)

    def test_never_automatically_reaches_oos_eligible_without_explicit_walk_forward_and_oos_flags(self):
        from research.dataset_readiness import SufficiencyReport

        result = run_empirical_program("fake-export", self._config(), SufficiencyReport(eligible=True, reasons=[]))
        self.assertNotIn("OOS_EVALUATION", result.eligible_experiments)


class ResearchReadyForPaperTests(unittest.TestCase):
    def _full_pass(self, **overrides):
        defaults = dict(
            branch_supported=True, cohort_supported=True, oos_ev_positive=True, tail_acceptable=True,
            calibration_acceptable=True, execution_assumptions_survive=True, uncertainty_acceptable=True,
            no_subgroup_collapse=True,
        )
        defaults.update(overrides)
        return ResearchPaperReadinessCheck(**defaults)

    def test_a_fully_passing_check_is_ready(self):
        self.assertTrue(research_ready_for_paper(self._full_pass()))

    def test_current_absent_data_state_is_never_ready(self):
        # Every OOS/tail/calibration/execution/uncertainty/subgroup field
        # is unknown (None) while EV_MODEL_NOT_EMPIRICALLY_READY -- this
        # must never default to True.
        check = ResearchPaperReadinessCheck(
            branch_supported=True, cohort_supported=True, oos_ev_positive=None, tail_acceptable=None,
            calibration_acceptable=None, execution_assumptions_survive=None, uncertainty_acceptable=None,
            no_subgroup_collapse=None,
        )
        self.assertFalse(research_ready_for_paper(check))

    def test_a_single_false_dimension_blocks_readiness(self):
        self.assertFalse(research_ready_for_paper(self._full_pass(tail_acceptable=False)))

    def test_an_unsupported_branch_blocks_readiness_even_if_everything_else_passes(self):
        self.assertFalse(research_ready_for_paper(self._full_pass(branch_supported=False)))


if __name__ == "__main__":
    unittest.main()
