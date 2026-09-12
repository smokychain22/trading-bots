"""The single auto-empirical entry point.

`run_theta_empirical_pipeline(raw_export, config, thresholds)` performs the
whole intake-to-artifact sequence automatically, so no manual chain of ten
research commands is needed the moment real data arrives:

    LOAD -> SCHEMA/HASH VALIDATION -> PIT AUDIT -> FEATURE/LABEL FIREWALL
    -> CANDIDATE-SET COMPLETENESS -> PROVENANCE -> CONTRACT/MULTIPLIER/UNIT
    -> BRANCH SLICING -> DEPENDENCE GROUPING -> DATA QUALITY REPORT
    -> READINESS CLASSIFICATION -> ONLY-ELIGIBLE EXPERIMENTS
    -> DETERMINISTIC ARTIFACTS -> MACHINE-READABLE STATUS

Speed comes from automation, never from lowering a scientific bar: the
readiness gate is enforced here, and an experiment whose `minimum_readiness`
exceeds the dataset's own state is REFUSED with a reason, not downgraded.

This module computes; it never activates anything. Codex owns Production.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from research.dataset_contracts import (
    Candidate,
    CensoringState,
    CompletenessState,
    DataQuality,
    HardStatus,
    SoftStatus,
    ThetaStrategyBranch,
)
from research.dataset_readiness import (
    DatasetReadinessState,
    DependenceGroupKey,
    EvidenceSourceLabel,
    ExperimentConfig,
    SufficiencyReport,
    SufficiencyThresholds,
    assess_model_fit_sufficiency,
    classify_dataset_readiness,
    effective_sample_size,
    slice_by_branch,
)
from research.experiment_registry import (
    EXPERIMENT_REGISTRY_VERSION,
    ExperimentDefinition,
    experiments_eligible_at,
)
from research.production_export_loader import (
    DatasetLoadError,
    LoadedDatasetExport,
    canonical_json,
    load_dataset_export,
    sha256_hex,
)
from research.research_targets import target_definition_version

PIPELINE_VERSION = "theta-empirical-pipeline-v1"


# ---------------------------------------------------------------------------
# Data-quality report (section 8's own required field list)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DataQualityReport:
    candidate_sets: int
    candidates: int
    shadow_candidates: int
    management_snapshots: int
    lifecycle_events: int
    outcome_labels: int
    execution_observations: int
    underlyings: int
    contracts: int
    branches: int
    sessions: int
    provenance_completeness: Optional[float]
    provider_timestamp_completeness: Optional[float]
    unknown_economics_rate: Optional[float]
    stale_rate: Optional[float]
    invalid_quote_rate: Optional[float]
    partial_scan_rate: Optional[float]
    hard_status_distribution: Dict[str, int]
    soft_status_distribution: Dict[str, int]
    rejection_reason_distribution: Dict[str, int]
    branch_distribution: Dict[str, int]
    resolved_labels: int
    right_censored_labels: int
    invalidated_labels: int
    selected_count: int
    unknown_multiplier_candidates: int
    contract_identity_violations: List[str]


def _rate(part: int, total: int) -> Optional[float]:
    return None if total == 0 else part / total


def _session_of(timestamp: str) -> str:
    return timestamp[:10]


def _contract_field(candidate: Candidate, key: str) -> Any:
    value = candidate.contract.get(key)
    return value


def audit_contract_identity(candidates: List[Candidate]) -> Tuple[int, List[str]]:
    """Contract identity / multiplier / unit audit. A candidate whose
    multiplier is unknown, or whose contract identity is internally
    inconsistent, may NEVER enter return/collateral analysis -- it is
    counted and named here rather than quietly repaired."""
    unknown_multiplier = 0
    violations: List[str] = []
    for candidate in candidates:
        multiplier = _contract_field(candidate, "multiplier")
        if multiplier is None:
            unknown_multiplier += 1
        elif not isinstance(multiplier, (int, float)) or multiplier <= 0:
            violations.append(f"{candidate.candidate_id}: non-positive/non-numeric multiplier {multiplier!r}")

        symbol = _contract_field(candidate, "contractSymbol")
        underlying = _contract_field(candidate, "underlying")
        if symbol is not None and underlying is not None and isinstance(symbol, str) and isinstance(underlying, str):
            if underlying and not symbol.startswith(underlying):
                violations.append(f"{candidate.candidate_id}: contractSymbol {symbol!r} inconsistent with underlying {underlying!r}")

        strike = _contract_field(candidate, "strike")
        if strike is not None and (not isinstance(strike, (int, float)) or strike <= 0):
            violations.append(f"{candidate.candidate_id}: non-positive/non-numeric strike {strike!r}")
    return unknown_multiplier, violations


def build_data_quality_report(export: LoadedDatasetExport) -> DataQualityReport:
    candidates = export.candidates
    total = len(candidates)

    underlyings = {u for c in export.candidate_sets for u in c.universe_evaluated}
    underlyings |= {str(_contract_field(c, "underlying")) for c in candidates if _contract_field(c, "underlying") is not None}
    contracts = {str(_contract_field(c, "contractSymbol")) for c in candidates if _contract_field(c, "contractSymbol") is not None}
    sessions = {_session_of(c.decision_time) for c in candidates}

    with_provenance = sum(1 for c in candidates if c.provider_provenance)
    provenance_entries = [p for c in candidates for p in c.provider_provenance]
    with_provider_ts = sum(1 for p in provenance_entries if p.provider_timestamp is not None)
    stale_entries = sum(1 for p in provenance_entries if p.state in (DataQuality.STALE, DataQuality.DEGRADED))
    unknown_econ = sum(1 for c in candidates if c.unknown_economics)

    invalid_quotes = sum(
        1 for e in export.execution_evidence
        if e.data_quality in (DataQuality.INVALID, DataQuality.NOT_ENTITLED)
        or (e.bid is not None and e.ask is not None and e.bid > e.ask)
    )
    partial_scans = sum(1 for s in export.candidate_sets if s.completeness_state != CompletenessState.COMPLETE)

    hard_dist: Dict[str, int] = {}
    soft_dist: Dict[str, int] = {}
    reason_dist: Dict[str, int] = {}
    branch_dist: Dict[str, int] = {}
    for candidate in candidates:
        hard_dist[candidate.hard_status.value] = hard_dist.get(candidate.hard_status.value, 0) + 1
        soft_dist[candidate.soft_status.value] = soft_dist.get(candidate.soft_status.value, 0) + 1
        branch_dist[candidate.branch.value] = branch_dist.get(candidate.branch.value, 0) + 1
        if candidate.soft_status == SoftStatus.REJECTED:
            reason = candidate.rejection_reason or "UNKNOWN"
            reason_dist[reason] = reason_dist.get(reason, 0) + 1

    resolved = sum(1 for e in export.whole_chain_outcomes if e.censoring_state == CensoringState.RESOLVED)
    censored = sum(1 for e in export.whole_chain_outcomes if e.censoring_state == CensoringState.RIGHT_CENSORED)
    invalidated = sum(1 for e in export.whole_chain_outcomes if e.censoring_state == CensoringState.INVALIDATED)

    unknown_multiplier, identity_violations = audit_contract_identity(candidates)

    return DataQualityReport(
        candidate_sets=len(export.candidate_sets), candidates=total,
        shadow_candidates=len(export.shadow_candidates), management_snapshots=len(export.management_snapshots),
        lifecycle_events=len(export.lifecycle_outcomes), outcome_labels=len(export.whole_chain_outcomes),
        execution_observations=len(export.execution_evidence),
        underlyings=len(underlyings), contracts=len(contracts), branches=len(branch_dist), sessions=len(sessions),
        provenance_completeness=_rate(with_provenance, total),
        provider_timestamp_completeness=_rate(with_provider_ts, len(provenance_entries)),
        unknown_economics_rate=_rate(unknown_econ, total),
        stale_rate=_rate(stale_entries, len(provenance_entries)),
        invalid_quote_rate=_rate(invalid_quotes, len(export.execution_evidence)),
        partial_scan_rate=_rate(partial_scans, len(export.candidate_sets)),
        hard_status_distribution=hard_dist, soft_status_distribution=soft_dist,
        rejection_reason_distribution=reason_dist, branch_distribution=branch_dist,
        resolved_labels=resolved, right_censored_labels=censored, invalidated_labels=invalidated,
        selected_count=sum(1 for c in candidates if c.selected),
        unknown_multiplier_candidates=unknown_multiplier, contract_identity_violations=identity_violations,
    )


# ---------------------------------------------------------------------------
# Cross-symbol completeness (section 8 of the R6G/R6H standard)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CrossSymbolCompleteness:
    complete_sets: int
    partial_sets: int
    unknown_sets: int
    usable_for_best_in_market_claims: bool
    reasons: List[str]


def assess_cross_symbol_completeness(export: LoadedDatasetExport) -> CrossSymbolCompleteness:
    """A PARTIAL scan is never usable as if it were COMPLETE. A
    best-opportunity-in-market claim requires at least one COMPLETE
    candidate set and zero partial/unknown sets contributing to the same
    claim -- otherwise the model would be trained on a preselected
    universe and interpreted as a market-wide selector."""
    complete = sum(1 for s in export.candidate_sets if s.completeness_state == CompletenessState.COMPLETE)
    partial = sum(1 for s in export.candidate_sets if s.completeness_state == CompletenessState.PARTIAL)
    unknown = sum(1 for s in export.candidate_sets if s.completeness_state == CompletenessState.UNKNOWN)

    reasons: List[str] = []
    if complete == 0:
        reasons.append("NO_COMPLETE_CANDIDATE_SET")
    if partial > 0:
        reasons.append(f"PARTIAL_CANDIDATE_SETS_PRESENT:{partial}")
    if unknown > 0:
        reasons.append(f"UNKNOWN_COMPLETENESS_CANDIDATE_SETS_PRESENT:{unknown}")

    return CrossSymbolCompleteness(
        complete_sets=complete, partial_sets=partial, unknown_sets=unknown,
        usable_for_best_in_market_claims=(complete > 0 and partial == 0 and unknown == 0),
        reasons=reasons,
    )


# ---------------------------------------------------------------------------
# Pipeline result
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PipelineResult:
    pipeline_version: str
    status: str  # DATASET_ABSENT | DATASET_PRESENT_UNUSABLE | OK
    readiness_state: DatasetReadinessState
    evidence_source: Optional[EvidenceSourceLabel]
    dataset_hash: Optional[str]
    data_quality: Optional[DataQualityReport]
    cross_symbol: Optional[CrossSymbolCompleteness]
    sufficiency: Optional[SufficiencyReport]
    effective_n: Optional[int]
    eligible_experiments: List[str]
    refused_experiments: List[Tuple[str, str]]  # (experiment_id, reason)
    integrity_failures: List[str]
    manifest: Dict[str, Any]
    artifacts_written: List[str] = field(default_factory=list)


def _dependence_keys(export: LoadedDatasetExport) -> List[DependenceGroupKey]:
    keys: List[DependenceGroupKey] = []
    for candidate in export.candidates:
        underlying = _contract_field(candidate, "underlying")
        keys.append(DependenceGroupKey(
            wheel_chain_id=None,  # a pre-entry candidate has no chain yet -- Codex's own parity review names this exactly
            economic_episode_id=candidate.decision_id,
            underlying=str(underlying) if underlying is not None else None,
            session_date=_session_of(candidate.decision_time),
            correlation_cluster=None,
        ))
    return keys


def _build_manifest(
    config: ExperimentConfig,
    export: Optional[LoadedDatasetExport],
    readiness: DatasetReadinessState,
    source_code_commit: Optional[str],
    run_timestamp: str,
) -> Dict[str, Any]:
    manifest: Dict[str, Any] = {
        "pipeline_version": PIPELINE_VERSION,
        "experiment_registry_version": EXPERIMENT_REGISTRY_VERSION,
        "target_version": target_definition_version(),
        "dataset_hash": export.dataset_hash if export else None,
        "schema_version": export.schema_version if export else None,
        "source_window_start": export.source_window_start if export else None,
        "source_window_end": export.source_window_end if export else None,
        "evidence_source": config.evidence_source.value,
        "strategy_branch": config.strategy_branch.value,
        "strategy_versions": list(export.strategy_versions) if export else [],
        "feature_version": config.feature_version,
        "cost_model_version": config.cost_model_version,
        "split_definition": config.split_definition,
        "experiment_id": config.experiment_id,
        "hypothesis_id": config.hypothesis_id,
        "readiness_state": readiness.value,
        "source_code_commit": source_code_commit,
        "run_timestamp": run_timestamp,
    }
    manifest["experiment_config_hash"] = sha256_hex(canonical_json(manifest))
    return manifest


def _serialize(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {k: _serialize(getattr(value, k)) for k in value.__dataclass_fields__}
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(v) for v in value]
    if hasattr(value, "value") and hasattr(value, "name"):  # Enum
        return value.value
    return value


def _write_artifacts(output_root: Path, result_parts: Dict[str, Any], dataset_hash: str, experiment_id: str) -> List[str]:
    """Deterministic artifact directory: research_outputs/<dataset_hash>/
    <experiment_id>/<name>.json. An existing directory is NEVER
    overwritten -- a repeated run of the same experiment against the same
    dataset raises, so a prior result cannot be silently replaced."""
    target = output_root / dataset_hash / experiment_id
    if target.exists():
        raise FileExistsError(
            f"EXPERIMENT_RESULT_ALREADY_EXISTS:{target} -- refusing to overwrite a prior experiment result"
        )
    target.mkdir(parents=True)
    written: List[str] = []
    for name, payload in result_parts.items():
        path = target / f"{name}.json"
        path.write_text(json.dumps(_serialize(payload), indent=2, sort_keys=True), encoding="utf-8")
        written.append(str(path))
    return written


def run_theta_empirical_pipeline(
    raw_export: Optional[Dict[str, Any]],
    config: ExperimentConfig,
    thresholds: Optional[SufficiencyThresholds] = None,
    output_root: Optional[Path] = None,
    source_code_commit: Optional[str] = None,
    run_timestamp: str = "",
    walk_forward_plan_valid: Optional[bool] = None,
    final_oos_untouched: Optional[bool] = None,
) -> PipelineResult:
    """One call does everything. Behavior by readiness (never bypassed):

    - `DATASET_ABSENT`: returns immediately naming the missing artifact.
    - `DATASET_PRESENT_UNUSABLE`: integrity diagnostics only, zero
      experiments, never a fit.
    - `DESCRIPTIVE_AUDIT_ONLY`: descriptive/strictness experiments only.
    - `MODEL_FIT_ELIGIBLE` and above: cumulatively more experiment kinds,
      each still gated by its own `minimum_readiness`.

    `thresholds` is REQUIRED to reach any state above
    DESCRIPTIVE_AUDIT_ONLY -- there is no built-in minimum sample size,
    per the standing no-invented-thresholds rule.
    """
    if raw_export is None:
        manifest = _build_manifest(config, None, DatasetReadinessState.DATASET_ABSENT, source_code_commit, run_timestamp)
        return PipelineResult(
            pipeline_version=PIPELINE_VERSION, status="DATASET_ABSENT",
            readiness_state=DatasetReadinessState.DATASET_ABSENT, evidence_source=config.evidence_source,
            dataset_hash=None, data_quality=None, cross_symbol=None, sufficiency=None, effective_n=None,
            eligible_experiments=[], refused_experiments=[],
            integrity_failures=["MISSING_ARTIFACT:DatasetExportArtifact (no Production dataset export supplied)"],
            manifest=manifest,
        )

    try:
        export = load_dataset_export(raw_export)
    except DatasetLoadError as error:
        manifest = _build_manifest(config, None, DatasetReadinessState.DATASET_PRESENT_UNUSABLE, source_code_commit, run_timestamp)
        return PipelineResult(
            pipeline_version=PIPELINE_VERSION, status="DATASET_PRESENT_UNUSABLE",
            readiness_state=DatasetReadinessState.DATASET_PRESENT_UNUSABLE, evidence_source=config.evidence_source,
            dataset_hash=raw_export.get("datasetHash"), data_quality=None, cross_symbol=None,
            sufficiency=None, effective_n=None, eligible_experiments=[], refused_experiments=[],
            integrity_failures=[str(error)], manifest=manifest,
        )

    quality = build_data_quality_report(export)
    cross_symbol = assess_cross_symbol_completeness(export)
    keys = _dependence_keys(export)
    effective_n = effective_sample_size(keys)

    integrity_failures: List[str] = list(quality.contract_identity_violations)

    sufficiency: Optional[SufficiencyReport] = None
    if thresholds is not None:
        # `or 0` here would be the exact UNKNOWN-to-zero failure mode this
        # codebase forbids: a RESOLVED row with an unknown net PnL is not a
        # zero-PnL outcome, and coercing it to 0 would silently count it as
        # a loss (0 <= 0) rather than excluding it from both buckets.
        labeled_outcomes = [
            e for e in export.whole_chain_outcomes
            if e.censoring_state == CensoringState.RESOLVED and e.whole_chain_net_pnl is not None
        ]
        positive = sum(1 for e in labeled_outcomes if e.whole_chain_net_pnl > 0)
        negative = sum(1 for e in labeled_outcomes if e.whole_chain_net_pnl <= 0)
        sufficiency = assess_model_fit_sufficiency(
            raw_n=quality.candidates, independent_n=effective_n, positive_outcomes=positive,
            negative_outcomes=negative, branch_coverage=quality.branches,
            regime_coverage=quality.sessions, thresholds=thresholds,
        )

    readiness = classify_dataset_readiness(export, sufficiency, walk_forward_plan_valid, final_oos_untouched)

    eligible_defs: List[ExperimentDefinition] = experiments_eligible_at(readiness.value)
    eligible_ids = [d.experiment_id for d in eligible_defs]
    eligible_set = set(eligible_ids)
    from research.experiment_registry import EXPERIMENTS

    refused: List[Tuple[str, str]] = [
        (d.experiment_id, f"REQUIRES_{d.minimum_readiness.value}_BUT_DATASET_IS_{readiness.value}")
        for d in EXPERIMENTS if d.experiment_id not in eligible_set
    ]
    if not cross_symbol.usable_for_best_in_market_claims:
        refused.append(("BEST_IN_MARKET_CLAIMS", "CROSS_SYMBOL_SCAN_INCOMPLETE:" + ",".join(cross_symbol.reasons)))

    # Branch slicing: grouped by EACH episode's OWN branch, then by
    # censoring state, never pooled. The v1 outcome row carries no branch
    # field of its own, and assigning every outcome to the caller's
    # configured `config.strategy_branch` would fabricate lineage a real
    # dataset never asserted -- so branch-resolved slicing stays empty
    # until a defensible per-episode branch join exists in the export.
    branch_slices: Dict[ThetaStrategyBranch, Any] = {}

    manifest = _build_manifest(config, export, readiness, source_code_commit, run_timestamp)

    artifacts: List[str] = []
    if output_root is not None:
        artifacts = _write_artifacts(
            output_root,
            {
                "manifest": manifest,
                "data_quality": quality,
                "readiness": {
                    "readiness_state": readiness.value,
                    "sufficiency": sufficiency,
                    "effective_n": effective_n,
                    "cross_symbol": cross_symbol,
                },
                "descriptive": {
                    "hard_status_distribution": quality.hard_status_distribution,
                    "soft_status_distribution": quality.soft_status_distribution,
                    "rejection_reason_distribution": quality.rejection_reason_distribution,
                    "branch_distribution": quality.branch_distribution,
                    "branch_slice_counts": {
                        branch.value: {
                            "resolved": len(s.resolved_episodes),
                            "censored": len(s.censored_episodes),
                            "invalidated": len(s.invalidated_episodes),
                        }
                        for branch, s in branch_slices.items()
                    },
                },
                "experiments": {"eligible": eligible_ids, "refused": refused},
                "failures": {"integrity_failures": integrity_failures},
            },
            export.dataset_hash,
            config.experiment_id,
        )

    return PipelineResult(
        pipeline_version=PIPELINE_VERSION, status="OK", readiness_state=readiness,
        evidence_source=config.evidence_source, dataset_hash=export.dataset_hash,
        data_quality=quality, cross_symbol=cross_symbol, sufficiency=sufficiency, effective_n=effective_n,
        eligible_experiments=eligible_ids, refused_experiments=refused,
        integrity_failures=integrity_failures, manifest=manifest, artifacts_written=artifacts,
    )


# ---------------------------------------------------------------------------
# Thin CLI wrapper -- zero pipeline logic of its own
# ---------------------------------------------------------------------------
#
#   PYTHONPATH=bots/theta/quant python -m research.empirical_pipeline \
#       --export path/to/dataset.json --output research_outputs/
#
# It only loads JSON from disk, builds the two config objects the function
# already requires, calls `run_theta_empirical_pipeline`, prints a concise
# summary, and chooses an exit code. Every decision -- readiness, which
# experiments are eligible, what is written -- stays in the function above.
# No credential is read, printed, or accepted.


_SUFFICIENCY_FLAGS = (
    "min-raw-n", "min-independent-n", "min-positive-outcomes",
    "min-negative-outcomes", "min-branch-coverage", "min-regime-coverage",
)


def _build_arg_parser():
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m research.empirical_pipeline",
        description="Run the THETA auto-empirical pipeline over a Production dataset export.",
    )
    parser.add_argument("--export", required=True, help="path to the dataset export JSON")
    parser.add_argument("--output", default="research_outputs", help="artifact root directory")
    parser.add_argument("--evidence-source", required=True,
                        choices=[label.value for label in EvidenceSourceLabel],
                        help="evidence class of this export -- never inferred, never blended")
    parser.add_argument("--strategy-branch", required=True,
                        choices=[branch.value for branch in ThetaStrategyBranch])
    parser.add_argument("--experiment-id", required=True)
    parser.add_argument("--hypothesis-id", default=None)
    parser.add_argument("--target-version", required=True)
    parser.add_argument("--feature-version", required=True)
    parser.add_argument("--cost-model-version", required=True)
    parser.add_argument("--split-definition", required=True)
    parser.add_argument("--source-code-commit", default=None)
    parser.add_argument("--run-timestamp", default="")
    for flag in _SUFFICIENCY_FLAGS:
        # Caller-supplied and caller-justified: omitting them leaves
        # thresholds unset, which caps readiness rather than inventing one.
        parser.add_argument(f"--{flag}", type=int, default=None)
    return parser


def _thresholds_from_args(args) -> Optional[SufficiencyThresholds]:
    values = [getattr(args, flag.replace("-", "_")) for flag in _SUFFICIENCY_FLAGS]
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise SystemExit(
            "SUFFICIENCY_THRESHOLDS_INCOMPLETE: supply all six --min-* flags or none. "
            "There is no default minimum sample size."
        )
    return SufficiencyThresholds(*values)


def main(argv: Optional[List[str]] = None) -> int:
    """Exit 0 when the pipeline ran to a status it can stand behind,
    2 when the dataset is structurally invalid or absent, 1 on a usage
    error. Prints the readiness state and artifact path, nothing else."""
    args = _build_arg_parser().parse_args(argv)

    export_path = Path(args.export)
    if not export_path.is_file():
        print(f"EXPORT_NOT_FOUND: {export_path}")
        return 2
    raw_export = json.loads(export_path.read_text(encoding="utf-8"))

    config = ExperimentConfig(
        dataset_hash=str(raw_export.get("datasetHash", "")),
        target_version=args.target_version,
        feature_version=args.feature_version,
        strategy_branch=ThetaStrategyBranch(args.strategy_branch),
        cost_model_version=args.cost_model_version,
        split_definition=args.split_definition,
        experiment_id=args.experiment_id,
        hypothesis_id=args.hypothesis_id,
        evidence_source=EvidenceSourceLabel(args.evidence_source),
    )

    result = run_theta_empirical_pipeline(
        raw_export=raw_export,
        config=config,
        thresholds=_thresholds_from_args(args),
        output_root=Path(args.output),
        source_code_commit=args.source_code_commit,
        run_timestamp=args.run_timestamp,
    )

    print(f"status={result.status}")
    print(f"readiness={result.readiness_state.value}")
    print(f"evidence_source={config.evidence_source.value}")
    print(f"dataset_hash={result.dataset_hash}")
    print(f"eligible_experiments={len(result.eligible_experiments)}")
    print(f"refused_experiments={len(result.refused_experiments)}")
    for failure in result.integrity_failures:
        print(f"integrity_failure: {failure}")
    for artifact in result.artifacts_written:
        print(f"artifact: {artifact}")
    return 0 if result.status == "OK" else 2


if __name__ == "__main__":  # pragma: no cover -- thin dispatch only
    raise SystemExit(main())
