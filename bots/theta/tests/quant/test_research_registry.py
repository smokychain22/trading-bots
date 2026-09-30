"""Structural and cross-reference integrity tests for the THETA Strategy DNA
research registry (bots/theta/quant/research/data/*.json).

Run with (from the repo root, once a Python toolchain is set up):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from unittest.mock import patch
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research import registry  # noqa: E402


class RegistryValidatesCleanlyTests(unittest.TestCase):
    def test_validate_registry_raises_nothing(self):
        # This is the single most important test in this file: if it raises,
        # something in the data files is internally inconsistent and must be
        # fixed before any backtester or model pipeline consumes this data.
        registry.validate_registry()

    def test_public_references_resolve_without_production_authority(self):
        for h in registry.load_hypotheses_raw():
            context = registry.hypothesis_evidence_context(h["hypothesis_id"])
            self.assertEqual(len(context["registry_hash"]), 64)
            self.assertEqual(context["production_authority"], "NONE")
            self.assertEqual({s["source_id"] for s in context["sources"]}, set(h.get("public_evidence_refs", [])))
        missing = [s for s in registry.load_public_evidence_registry()["sources"] if s["state"] == "OWNER_SOURCE_NOT_SUPPLIED"]
        self.assertEqual(len(missing), 3)
        self.assertTrue(all(s["claim"] is None for s in missing))

    def test_missing_duplicate_or_unknown_reference_fails_closed(self):
        for refs in (["unknown"], ["cboe_put_index", "cboe_put_index"]):
            with patch.object(registry, "load_hypotheses_raw", return_value=[{"hypothesis_id": "H", "public_evidence_refs": refs}]):
                with self.assertRaisesRegex(registry.ResearchRegistryError, "PUBLIC_REFERENCE_UNKNOWN_OR_DUPLICATE"):
                    registry.hypothesis_evidence_context("H")
        with self.assertRaisesRegex(registry.ResearchRegistryError, "UNKNOWN_HYPOTHESIS"):
            registry.hypothesis_evidence_context("invented")

    def test_reference_cannot_gain_authority_or_invent_missing_claim(self):
        raw = registry.load_public_evidence_registry()
        raw["sources"][0]["production_authority"] = "PRODUCTION"
        with patch.object(registry, "_load_json", return_value=raw):
            with self.assertRaisesRegex(registry.ResearchRegistryError, "AUTHORITY_INVALID"):
                registry.load_public_evidence_registry()
        raw = registry.load_public_evidence_registry()
        raw["sources"][-1]["claim"] = "profitable"
        with patch.object(registry, "_load_json", return_value=raw):
            with self.assertRaisesRegex(registry.ResearchRegistryError, "FABRICATED_CLAIM"):
                registry.load_public_evidence_registry()

    def test_pipeline_persists_hash_bound_source_context_without_changing_readiness(self):
        from research.empirical_pipeline import run_theta_empirical_pipeline
        from research.dataset_readiness import ExperimentConfig, EvidenceSourceLabel
        from research.dataset_contracts import ThetaStrategyBranch
        config = ExperimentConfig(dataset_hash="", target_version="v1", feature_version="v1",
                                  strategy_branch=ThetaStrategyBranch.THETA_CONVENTIONAL, cost_model_version="v1",
                                  split_definition="v1", experiment_id="EXP-Q-01", hypothesis_id="H-Q-01",
                                  evidence_source=EvidenceSourceLabel.HISTORICAL_REPLAY)
        result = run_theta_empirical_pipeline(None, config)
        self.assertEqual(result.status, "DATASET_ABSENT")
        self.assertEqual(len(result.manifest["professional_source_context"]["sources"]), 2)
        self.assertEqual(result.manifest["professional_source_context"]["empirical_validation"], "NOT_ESTABLISHED_BY_REFERENCE")


class HypothesisCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hypotheses = registry.load_hypotheses_raw()
        cls.by_id = {h["hypothesis_id"]: h for h in cls.hypotheses}

    def test_every_archetype_has_at_least_one_hypothesis(self):
        archetype_ids = registry.load_archetype_ids()
        covered = {h["archetype_id"] for h in self.hypotheses}
        missing = archetype_ids - covered
        self.assertEqual(missing, set(), f"archetypes with no hypotheses: {missing}")

    def test_every_hypothesis_has_a_valid_status(self):
        for h in self.hypotheses:
            self.assertIn(h["status"], registry.HYPOTHESIS_STATUSES)

    def test_every_hypothesis_has_the_full_required_field_set(self):
        # mechanism/state/alternatives/label_type/label_definition/
        # payoff_target/failure_mode/calibration_requirement/
        # evidence_requirement/acceptance_criterion/rejection_criterion
        for h in self.hypotheses:
            for field in registry.REQUIRED_HYPOTHESIS_FIELDS:
                self.assertIn(field, h, f"{h['hypothesis_id']} missing {field}")

    def test_every_label_type_is_valid(self):
        for h in self.hypotheses:
            self.assertIn(h["label_type"], registry.LABEL_TYPES, h["hypothesis_id"])

    def test_measurement_hypotheses_use_the_na_measurement_label(self):
        for h in self.hypotheses:
            if h["hypothesis_type"] == "measurement":
                self.assertEqual(h["label_type"], "N/A_MEASUREMENT", h["hypothesis_id"])

    def test_contradiction_pair_is_symmetric_and_present(self):
        # H-R-01 (active management) and H-R-02 (patience) are the
        # deliberately preserved contradiction from the corpus -- this test
        # guards against a future edit silently resolving it by deleting one
        # side or breaking the symmetric contradicts[] link.
        h_r_01 = self.by_id["H-R-01"]
        h_r_02 = self.by_id["H-R-02"]
        self.assertIn("H-R-02", h_r_01["contradicts"])
        self.assertIn("H-R-01", h_r_02["contradicts"])

    def test_failure_dna_hypotheses_are_retained_not_dropped(self):
        # The SQQQ Hold-the-Strike failure-DNA lesson must survive as an
        # explicit, non-deletable measurement hypothesis.
        h_a_03 = self.by_id["H-A-03"]
        self.assertEqual(h_a_03["hypothesis_type"], "measurement")
        self.assertEqual(h_a_03["status"], "RETAIN")

    def test_gated_defined_risk_hypothesis_is_not_marked_ready(self):
        h_d_01 = self.by_id["H-D-01"]
        self.assertIn("gated_until", h_d_01)
        self.assertEqual(h_d_01["data_availability_status"], "BLOCKED_ON_ALPACA_ENTITLEMENT")

    def test_no_hypothesis_claims_a_performance_number(self):
        # Structural guard against someone later pasting a result straight
        # into the hypothesis registry instead of into an actual experiment
        # run record -- this file is pre-registration only.
        forbidden_keys = {
            "realized_wr",
            "managed_episode_wr",
            "ev_net_result",
            "profit_factor_result",
            "backtest_result",
        }
        for h in self.hypotheses:
            self.assertTrue(
                forbidden_keys.isdisjoint(h.keys()),
                f"{h['hypothesis_id']} contains a result-shaped field: "
                f"{forbidden_keys.intersection(h.keys())}",
            )


class ExperimentAcceptanceCriteriaTests(unittest.TestCase):
    def test_shared_criteria_contain_no_invented_numeric_thresholds(self):
        import json

        raw = json.loads(
            (registry._RESEARCH_DATA_DIR / "experiments.json").read_text(encoding="utf-8")
        )
        # Guard against a future edit adding a bare invented threshold like
        # "p < 0.05" or "EV_net > 100" directly into the shared criteria --
        # the acceptance standard should stay qualitative/TRD-referenced.
        import re

        numeric_threshold_pattern = re.compile(r"[<>]=?\s*\d")
        for criterion in raw["shared_acceptance_criteria"] + raw["shared_rejection_criteria"]:
            self.assertIsNone(
                numeric_threshold_pattern.search(criterion),
                f"criterion appears to contain an invented numeric threshold: {criterion!r}",
            )


if __name__ == "__main__":
    unittest.main()
