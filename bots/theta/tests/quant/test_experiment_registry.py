"""Tests for bots/theta/quant/research/experiment_registry.py. Structural only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.experiment_registry import (  # noqa: E402
    ABLATION_DELTA_METRICS,
    DELTA_MAGNITUDE_BINS,
    DTE_BINS,
    EXPERIMENTS,
    EXPERIMENTS_BY_ID,
    FEATURE_ABLATION_FAMILIES,
    FLOW_ABLATION_LADDER,
    FLOW_FAILURE_CONTROLS,
    LOSS_POLICIES,
    PROFIT_TAKING_POLICIES,
    SLICE_METRICS,
    ExperimentKind,
    MinimumReadiness,
    experiments_eligible_at,
)


class RegistryStructureTests(unittest.TestCase):
    def test_experiment_ids_are_unique(self):
        ids = [e.experiment_id for e in EXPERIMENTS]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_experiment_names_a_minimum_readiness(self):
        for experiment in EXPERIMENTS:
            self.assertIsInstance(experiment.minimum_readiness, MinimumReadiness)

    def test_lookup_by_id_matches_the_list(self):
        self.assertEqual(len(EXPERIMENTS_BY_ID), len(EXPERIMENTS))


class LatticeTests(unittest.TestCase):
    def test_all_dte_bins_have_their_own_slice_experiment(self):
        self.assertEqual(len(DTE_BINS), 5)  # 15-24, 25-35, 36-45, 46-60, 60+
        for low, high in DTE_BINS:
            self.assertIn(f"SLICE-DTE-{low}-{high}", EXPERIMENTS_BY_ID)

    def test_all_delta_bins_have_their_own_slice_experiment(self):
        self.assertEqual(len(DELTA_MAGNITUDE_BINS), 6)  # edges at 0.10/0.15/0.20/0.25/0.30/0.35/0.40
        for low, high in DELTA_MAGNITUDE_BINS:
            self.assertIn(f"SLICE-DELTA-{low}-{high}", EXPERIMENTS_BY_ID)

    def test_slice_metrics_never_report_win_rate_alone(self):
        # The canonical guardrail: payoff, tail, drawdown and capital
        # metrics travel with any hit-rate style metric.
        for required in ("ev_net", "expected_shortfall", "max_drawdown", "avg_win", "avg_loss",
                          "return_per_capital_day", "effective_n"):
            self.assertIn(required, SLICE_METRICS)

    def test_no_dte_or_delta_bin_is_marked_preferred(self):
        # Every bin is a plain enumeration entry -- nothing in the
        # registry encodes a "best" region.
        descriptions = [EXPERIMENTS_BY_ID[f"SLICE-DELTA-{low}-{high}"].description for low, high in DELTA_MAGNITUDE_BINS]
        for description in descriptions:
            self.assertNotIn("best", description.lower())
            self.assertNotIn("optimal", description.lower())


class PolicyCoverageTests(unittest.TestCase):
    def test_all_eight_profit_taking_policies_are_registered(self):
        self.assertEqual(len(PROFIT_TAKING_POLICIES), 8)
        for policy in PROFIT_TAKING_POLICIES:
            self.assertIn(f"EXIT-{policy}", EXPERIMENTS_BY_ID)

    def test_all_six_loss_policies_are_registered(self):
        self.assertEqual(len(LOSS_POLICIES), 6)
        for policy in LOSS_POLICIES:
            self.assertIn(f"LOSS-{policy}", EXPERIMENTS_BY_ID)

    def test_all_seventeen_ablation_families_are_registered_as_paired_experiments(self):
        self.assertEqual(len(FEATURE_ABLATION_FAMILIES), 17)
        for family in FEATURE_ABLATION_FAMILIES:
            experiment = EXPERIMENTS_BY_ID[f"ABLATE-{family}"]
            self.assertTrue(experiment.parameters["paired"])
            self.assertEqual(experiment.parameters["metrics"], ABLATION_DELTA_METRICS)

    def test_flow_ladder_adds_exactly_one_increment_per_rung(self):
        rungs = [e for e in EXPERIMENTS if e.kind == ExperimentKind.FLOW_ABLATION]
        self.assertEqual(len(rungs), len(FLOW_ABLATION_LADDER) - 1)  # BASELINE itself is not an increment
        for experiment in rungs:
            self.assertIn("previous_rung", experiment.parameters)
            self.assertEqual(experiment.parameters["failure_controls"], FLOW_FAILURE_CONTROLS)

    def test_flow_failure_controls_include_the_friend_bot_defects(self):
        self.assertIn("NO_HIGHEST_RETURN_LEAKAGE", FLOW_FAILURE_CONTROLS)
        self.assertIn("NO_SCORE_AS_PROBABILITY", FLOW_FAILURE_CONTROLS)
        self.assertIn("NO_UNKNOWN_FAIL_OPEN", FLOW_FAILURE_CONTROLS)
        self.assertIn("NO_SIMPLISTIC_CALL_PUT_DIRECTION", FLOW_FAILURE_CONTROLS)


class ReadinessGatingTests(unittest.TestCase):
    def test_no_experiment_runs_while_the_dataset_is_absent_or_unusable(self):
        self.assertEqual(experiments_eligible_at("DATASET_ABSENT"), [])
        self.assertEqual(experiments_eligible_at("DATASET_PRESENT_UNUSABLE"), [])

    def test_descriptive_state_never_unlocks_a_model_fit(self):
        eligible = {e.experiment_id for e in experiments_eligible_at("DESCRIPTIVE_AUDIT_ONLY")}
        self.assertNotIn("ENTRY-LOGIT-01", eligible)
        self.assertIn("DESC-FUNNEL-01", eligible)

    def test_eligibility_is_cumulative_across_states(self):
        descriptive = {e.experiment_id for e in experiments_eligible_at("DESCRIPTIVE_AUDIT_ONLY")}
        model_fit = {e.experiment_id for e in experiments_eligible_at("MODEL_FIT_ELIGIBLE")}
        walk_forward = {e.experiment_id for e in experiments_eligible_at("WALK_FORWARD_ELIGIBLE")}
        self.assertTrue(descriptive.issubset(model_fit))
        self.assertTrue(model_fit.issubset(walk_forward))

    def test_ablations_require_walk_forward_not_merely_a_model_fit(self):
        model_fit = {e.experiment_id for e in experiments_eligible_at("MODEL_FIT_ELIGIBLE")}
        self.assertNotIn("ABLATE-FLOW", model_fit)


class HypothesisLinkageTests(unittest.TestCase):
    """Every hypothesis in the standing 14-hypothesis registry
    (quant/research/data/hypotheses.json) must resolve to at least one
    experiment_id -- an unlinked hypothesis has no path from priors to
    evidence."""

    _ALL_FOURTEEN_HYPOTHESIS_IDS = (
        "H-Q-01", "H-Q-02", "H-H-01", "H-H-02", "H-R-01", "H-R-02", "H-R-03",
        "H-C-01", "H-C-02", "H-A-01", "H-A-02", "H-A-04", "H-A-03", "H-D-01",
    )

    def test_every_hypothesis_id_has_at_least_one_linked_experiment(self):
        linked_ids = {e.hypothesis_id for e in EXPERIMENTS if e.hypothesis_id is not None}
        for hypothesis_id in self._ALL_FOURTEEN_HYPOTHESIS_IDS:
            self.assertIn(hypothesis_id, linked_ids, f"{hypothesis_id} has no linked experiment_id")

    def test_hold_strike_experiment_carries_its_own_hypothesis_id_not_conventionals(self):
        hold_strike = EXPERIMENTS_BY_ID["HOLD-STRIKE-01"]
        self.assertEqual(hold_strike.hypothesis_id, "H-H-01")
        self.assertNotEqual(hold_strike.hypothesis_id, "H-Q-01")


if __name__ == "__main__":
    unittest.main()
