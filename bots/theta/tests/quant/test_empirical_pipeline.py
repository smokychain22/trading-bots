"""Tests for bots/theta/quant/research/empirical_pipeline.py. Synthetic fixtures only."""

import sys
import tempfile
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.dataset_contracts import ThetaStrategyBranch  # noqa: E402
from research.dataset_readiness import (  # noqa: E402
    DatasetReadinessState,
    EvidenceSourceLabel,
    ExperimentConfig,
    SufficiencyThresholds,
)
from research.empirical_pipeline import (  # noqa: E402
    assess_cross_symbol_completeness,
    audit_contract_identity,
    main as empirical_pipeline_main,
    run_theta_empirical_pipeline,
)
from research.production_export_loader import (  # noqa: E402
    DATASET_SCHEMA_VERSION,
    canonical_json,
    load_dataset_export,
    sha256_hex,
)


def _provenance():
    return {
        "source": "ALPACA", "operationAlias": "options.snapshots", "providerTimestamp": "2026-01-01T14:30:00+00:00",
        "ingestionTimestamp": "2026-01-01T14:30:01+00:00", "asOf": "2026-01-01T14:30:00+00:00",
        "version": "v1", "state": "GOOD",
    }


def _candidate_raw(candidate_id="c1", selected=True, multiplier=100, underlying="AAPL",
                    symbol="AAPL260117P00150000", hard="FEASIBLE", soft="RANKED", reason=None):
    return {
        "candidateId": candidate_id, "decisionId": "d1", "fusionSnapshotId": "fs1",
        "decisionTime": "2026-01-01T14:30:00+00:00", "branch": "THETA_CONVENTIONAL",
        "rankAtDecision": 1, "selected": selected, "hardStatus": hard, "softStatus": soft,
        "rejectionReason": reason,
        "contract": {"underlying": underlying, "contractSymbol": symbol, "strike": 150.0, "multiplier": multiplier},
        "market": {}, "volatility": {"ivRank": 0.5}, "technical": {}, "event": {}, "flow": {},
        "ownership": {}, "account": {}, "portfolio": {}, "aegis": {}, "execution": {}, "knownEconomics": {},
        "unknownEconomics": [], "hardBlockers": [], "softEvidence": [], "providerProvenance": [_provenance()],
        "lineage": {
            "strategyVersion": "sv-1", "riskVersion": "rv-1", "featureVersion": "fv-1",
            "costModelVersion": "cm-1", "regimeVersion": "rg-1", "executionModelVersion": "em-1",
        },
        "contentHash": "a" * 64,
    }


def _candidate_set_raw(completeness="COMPLETE", best="c1"):
    return {
        "candidateSetId": "cs1", "decisionTime": "2026-01-01T14:30:00+00:00",
        "universeEvaluated": ["AAPL"], "branchesConsidered": ["THETA_CONVENTIONAL"],
        "counts": {"enumerated": 1}, "bestCandidateId": best, "secondBestCandidateId": None,
        "bestRejectedCandidateId": None, "completenessState": completeness, "missingScope": [],
        "contentHash": "b" * 64,
    }


def _build_export(candidates=None, candidate_sets=None, **row_overrides):
    rows = {
        "candidateSets": candidate_sets if candidate_sets is not None else [_candidate_set_raw()],
        "candidates": candidates if candidates is not None else [_candidate_raw()],
        "shadowCandidates": [], "managementSnapshots": [], "lifecycleOutcomes": [],
        "wholeChainOutcomes": [], "executionEvidence": [],
    }
    rows.update(row_overrides)
    unsigned = {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "sourceWindow": {"start": "2026-01-01T00:00:00+00:00", "end": "2026-01-02T00:00:00+00:00"},
        "exportedAt": "2026-01-02T00:00:00+00:00", "featureSetVersion": "fv-1",
        "strategyVersions": ["sv-1"],
        "rows": {k: sorted(v, key=canonical_json) for k, v in rows.items()},
        "rowCounts": {k: len(v) for k, v in rows.items()},
    }
    export = dict(unsigned)
    export["rows"] = rows
    export["datasetHash"] = sha256_hex(canonical_json(unsigned))
    return export


def _config(**overrides):
    defaults = dict(
        dataset_hash="h1", target_version="theta-research-targets-v1", feature_version="fv-1",
        strategy_branch=ThetaStrategyBranch.THETA_CONVENTIONAL, cost_model_version="cm-1",
        split_definition="sd-1", experiment_id="DESC-FUNNEL-01", hypothesis_id=None,
        evidence_source=EvidenceSourceLabel.LIVE_SHADOW,
    )
    defaults.update(overrides)
    return ExperimentConfig(**defaults)


def _thresholds(**overrides):
    defaults = dict(min_raw_n=1, min_independent_n=1, min_positive_outcomes=0,
                     min_negative_outcomes=0, min_branch_coverage=1, min_regime_coverage=1)
    defaults.update(overrides)
    return SufficiencyThresholds(**defaults)


class DatasetAbsentTests(unittest.TestCase):
    def test_no_export_returns_dataset_absent_and_names_the_missing_artifact(self):
        result = run_theta_empirical_pipeline(None, _config())
        self.assertEqual(result.status, "DATASET_ABSENT")
        self.assertEqual(result.readiness_state, DatasetReadinessState.DATASET_ABSENT)
        self.assertTrue(any("MISSING_ARTIFACT" in f for f in result.integrity_failures))

    def test_no_export_runs_zero_experiments(self):
        result = run_theta_empirical_pipeline(None, _config())
        self.assertEqual(result.eligible_experiments, [])


class DatasetUnusableTests(unittest.TestCase):
    def test_a_corrupt_export_runs_integrity_diagnostics_only_and_never_fits(self):
        export = _build_export()
        export["schemaVersion"] = "theta-r6-dataset-v0"  # wrong schema version
        result = run_theta_empirical_pipeline(export, _config())
        self.assertEqual(result.status, "DATASET_PRESENT_UNUSABLE")
        self.assertEqual(result.eligible_experiments, [])
        self.assertTrue(any("SCHEMA_VERSION_MISMATCH" in f for f in result.integrity_failures))

    def test_a_future_label_in_a_feature_payload_makes_the_dataset_unusable(self):
        candidate = _candidate_raw()
        candidate["market"] = {"realized_pnl": 100.0}
        export = _build_export(candidates=[candidate])
        result = run_theta_empirical_pipeline(export, _config())
        self.assertEqual(result.status, "DATASET_PRESENT_UNUSABLE")
        self.assertTrue(any("FUTURE_LABEL_IN_FEATURE_PAYLOAD" in f for f in result.integrity_failures))


class DescriptiveOnlyTests(unittest.TestCase):
    def test_valid_export_without_thresholds_is_descriptive_audit_only(self):
        result = run_theta_empirical_pipeline(_build_export(), _config())
        self.assertEqual(result.status, "OK")
        self.assertEqual(result.readiness_state, DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY)

    def test_descriptive_state_permits_only_descriptive_and_strictness_experiments(self):
        result = run_theta_empirical_pipeline(_build_export(), _config())
        self.assertIn("DESC-FUNNEL-01", result.eligible_experiments)
        self.assertNotIn("ENTRY-LOGIT-01", result.eligible_experiments)
        refused_ids = {experiment_id for experiment_id, _ in result.refused_experiments}
        self.assertIn("ENTRY-LOGIT-01", refused_ids)

    def test_every_refusal_carries_a_reason(self):
        result = run_theta_empirical_pipeline(_build_export(), _config())
        for _, reason in result.refused_experiments:
            self.assertGreater(len(reason), 0)

    def test_data_quality_report_is_populated(self):
        result = run_theta_empirical_pipeline(_build_export(), _config())
        quality = result.data_quality
        self.assertEqual(quality.candidates, 1)
        self.assertEqual(quality.candidate_sets, 1)
        self.assertEqual(quality.selected_count, 1)
        self.assertEqual(quality.hard_status_distribution["FEASIBLE"], 1)
        self.assertAlmostEqual(quality.provenance_completeness, 1.0)


class ReadinessNeverBypassedTests(unittest.TestCase):
    def test_sufficient_thresholds_reach_model_fit_but_not_walk_forward(self):
        result = run_theta_empirical_pipeline(_build_export(), _config(), _thresholds())
        self.assertEqual(result.readiness_state, DatasetReadinessState.MODEL_FIT_ELIGIBLE)
        self.assertIn("ENTRY-LOGIT-01", result.eligible_experiments)
        self.assertNotIn("ABLATE-VOLATILITY", result.eligible_experiments)

    def test_walk_forward_flag_unlocks_ablations_only_when_plan_is_valid(self):
        result = run_theta_empirical_pipeline(
            _build_export(), _config(), _thresholds(), walk_forward_plan_valid=True,
        )
        self.assertEqual(result.readiness_state, DatasetReadinessState.WALK_FORWARD_ELIGIBLE)
        self.assertIn("ABLATE-VOLATILITY", result.eligible_experiments)

    def test_insufficient_sample_cannot_reach_model_fit_however_it_is_configured(self):
        result = run_theta_empirical_pipeline(
            _build_export(), _config(), _thresholds(min_raw_n=10_000),
            walk_forward_plan_valid=True, final_oos_untouched=True,
        )
        self.assertEqual(result.readiness_state, DatasetReadinessState.DESCRIPTIVE_AUDIT_ONLY)
        self.assertNotIn("ENTRY-LOGIT-01", result.eligible_experiments)


class CrossSymbolCompletenessTests(unittest.TestCase):
    def test_a_complete_scan_supports_best_in_market_claims(self):
        export = load_dataset_export(_build_export())
        assessment = assess_cross_symbol_completeness(export)
        self.assertTrue(assessment.usable_for_best_in_market_claims)

    def test_a_partial_scan_never_supports_best_in_market_claims(self):
        export = load_dataset_export(_build_export(candidate_sets=[_candidate_set_raw(completeness="PARTIAL")]))
        assessment = assess_cross_symbol_completeness(export)
        self.assertFalse(assessment.usable_for_best_in_market_claims)
        self.assertTrue(any("PARTIAL" in r for r in assessment.reasons))

    def test_a_partial_scan_refuses_best_in_market_claims_in_the_pipeline_result(self):
        result = run_theta_empirical_pipeline(
            _build_export(candidate_sets=[_candidate_set_raw(completeness="PARTIAL")]), _config(),
        )
        refused_ids = {experiment_id for experiment_id, _ in result.refused_experiments}
        self.assertIn("BEST_IN_MARKET_CLAIMS", refused_ids)


class ContractIdentityAuditTests(unittest.TestCase):
    def test_unknown_multiplier_is_counted_not_defaulted_to_one_hundred(self):
        export = load_dataset_export(_build_export(candidates=[_candidate_raw(multiplier=None)]))
        unknown, violations = audit_contract_identity(export.candidates)
        self.assertEqual(unknown, 1)
        self.assertEqual(violations, [])

    def test_inconsistent_contract_symbol_is_flagged(self):
        export = load_dataset_export(_build_export(
            candidates=[_candidate_raw(underlying="MSFT", symbol="AAPL260117P00150000")],
        ))
        _, violations = audit_contract_identity(export.candidates)
        self.assertTrue(any("inconsistent with underlying" in v for v in violations))

    def test_identity_violations_surface_as_pipeline_integrity_failures(self):
        result = run_theta_empirical_pipeline(
            _build_export(candidates=[_candidate_raw(underlying="MSFT", symbol="AAPL260117P00150000")]),
            _config(),
        )
        self.assertTrue(any("inconsistent" in f for f in result.integrity_failures))


class ArtifactTests(unittest.TestCase):
    def test_artifacts_are_written_under_dataset_hash_and_experiment_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = run_theta_empirical_pipeline(_build_export(), _config(), output_root=root)
            self.assertGreater(len(result.artifacts_written), 0)
            target = root / result.dataset_hash / "DESC-FUNNEL-01"
            self.assertTrue((target / "manifest.json").exists())
            self.assertTrue((target / "data_quality.json").exists())
            self.assertTrue((target / "readiness.json").exists())

    def test_a_repeated_run_never_overwrites_a_prior_experiment_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_theta_empirical_pipeline(_build_export(), _config(), output_root=root)
            with self.assertRaises(FileExistsError):
                run_theta_empirical_pipeline(_build_export(), _config(), output_root=root)

    def test_manifest_carries_full_reproducibility_identity(self):
        result = run_theta_empirical_pipeline(_build_export(), _config(), source_code_commit="abc123", run_timestamp="2026-01-02T00:00:00+00:00")
        manifest = result.manifest
        for key in ("dataset_hash", "schema_version", "evidence_source", "strategy_branch",
                     "feature_version", "cost_model_version", "split_definition", "experiment_id",
                     "target_version", "source_code_commit", "run_timestamp", "experiment_config_hash"):
            self.assertIn(key, manifest)

    def test_evidence_source_is_always_explicit_in_the_manifest(self):
        result = run_theta_empirical_pipeline(_build_export(), _config(evidence_source=EvidenceSourceLabel.PAPER_EXECUTION))
        self.assertEqual(result.manifest["evidence_source"], "PAPER_EXECUTION")


class CliWrapperTests(unittest.TestCase):
    """The CLI is a THIN wrapper: it loads, delegates, prints, exits. It
    owns no pipeline logic and must never relax a readiness gate."""

    def _argv(self, export_path, output, extra=()):
        return [
            "--export", str(export_path), "--output", str(output),
            "--evidence-source", "LIVE_SHADOW", "--strategy-branch", "THETA_CONVENTIONAL",
            "--experiment-id", "CLI_TEST", "--target-version", "v1",
            "--feature-version", "v1", "--cost-model-version", "v1",
            "--split-definition", "s1", *extra,
        ]

    def test_a_missing_export_file_exits_nonzero_without_running_anything(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "absent.json"
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = empirical_pipeline_main(self._argv(missing, tmp))
            self.assertEqual(code, 2)
            self.assertIn("EXPORT_NOT_FOUND", out.getvalue())

    def test_a_structurally_invalid_export_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.json"
            bad.write_text(json.dumps({"schema_version": "not-the-contract"}), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = empirical_pipeline_main(self._argv(bad, tmp))
            self.assertEqual(code, 2)
            self.assertIn("DATASET_PRESENT_UNUSABLE", out.getvalue())

    def test_partial_sufficiency_thresholds_are_refused_rather_than_defaulted(self):
        with tempfile.TemporaryDirectory() as tmp:
            export = Path(tmp) / "export.json"
            export.write_text(json.dumps(_build_export()), encoding="utf-8")
            with self.assertRaises(SystemExit) as raised:
                empirical_pipeline_main(self._argv(export, tmp, extra=["--min-raw-n", "10"]))
            self.assertIn("SUFFICIENCY_THRESHOLDS_INCOMPLETE", str(raised.exception))

    def test_a_valid_export_runs_and_reports_its_readiness(self):
        with tempfile.TemporaryDirectory() as tmp:
            export = Path(tmp) / "export.json"
            export.write_text(json.dumps(_build_export()), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = empirical_pipeline_main(self._argv(export, tmp))
            printed = out.getvalue()
            self.assertEqual(code, 0)
            self.assertIn("readiness=", printed)
            self.assertIn("evidence_source=LIVE_SHADOW", printed)


if __name__ == "__main__":
    unittest.main()
