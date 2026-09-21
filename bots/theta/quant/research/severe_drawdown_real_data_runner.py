"""Real-data study runner for severe-downside calibration (directive Phase
9D). Runs the cohort-quantile baseline and the logistic-regression binary
baseline against a Codex-produced sanitized canonical export once one
exists; before then, reports AWAITING_REAL_EXPORT rather than fabricating
a result from synthetic fixtures and calling it a real study.

EXPORT CONTRACT for Codex: a dict matching the envelope shape below, whose
``rows`` are already-materialized ``ContinuousTargetRow``-equivalent dicts
(see severe_drawdown_continuous_target.py) for the cohort-quantile study,
and ``LogisticTrainingRow``-equivalent dicts (feature vector + binary
label) for the logistic baseline -- this runner performs no file I/O and
no feature engineering itself; it only validates the envelope and calls
the already-built research functions.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, List, Mapping, Optional, Tuple

from calibration.severe_drawdown_logistic_baseline import (
    DatedLogisticRow,
    LogisticTrainingRow,
    chronological_train_test_split,
    evaluate_calibration,
    fit_logistic_regression,
    predict_probability,
)
from research.severe_drawdown_cohort_quantile_baseline import (
    CohortQuantileInputRow,
    evaluate_cohort_quantile_baseline,
    summarize_cohort_quantile_coverage,
)

SEVERE_DRAWDOWN_REAL_DATA_RUNNER_VERSION = "theta-severe-drawdown-real-data-runner-v1"
CONTINUOUS_TARGET_EXPORT_CONTRACT_VERSION = "theta-continuous-target-export-v1"
BINARY_LABEL_EXPORT_CONTRACT_VERSION = "theta-binary-label-export-v1"

EvidenceLineage = str  # 'REAL_EXPORT' | 'SYNTHETIC_FIXTURE'


def _validate_envelope(export: Optional[Mapping[str, Any]], expected_version: str) -> Tuple[str, Optional[str], Optional[List[Any]]]:
    """Returns (status, reason, rows). status is one of
    AWAITING_REAL_EXPORT / EXPORT_CONTRACT_INVALID / EXPORT_ROW_COUNT_MISMATCH / LOADED.
    """
    if export is None:
        return "AWAITING_REAL_EXPORT", "NO_EXPORT_SUPPLIED", None
    if not isinstance(export, dict):
        return "EXPORT_CONTRACT_INVALID", "EXPORT_NOT_AN_OBJECT", None
    if export.get("exportContractVersion") != expected_version:
        return "EXPORT_CONTRACT_INVALID", "EXPORT_CONTRACT_VERSION_MISMATCH", None
    if export.get("sanitized") is not True:
        return "EXPORT_CONTRACT_INVALID", "EXPORT_NOT_ATTESTED_SANITIZED", None
    if not isinstance(export.get("sourceDescription"), str) or not export["sourceDescription"].strip():
        return "EXPORT_CONTRACT_INVALID", "EXPORT_SOURCE_DESCRIPTION_MISSING", None
    rows = export.get("rows")
    if not isinstance(rows, list):
        return "EXPORT_CONTRACT_INVALID", "EXPORT_ROWS_NOT_A_LIST", None
    if export.get("rowCount") != len(rows):
        return "EXPORT_ROW_COUNT_MISMATCH", "EXPORT_ROW_COUNT_DOES_NOT_MATCH_ROWS_LENGTH", None
    return "LOADED", None, rows


@dataclass(frozen=True)
class CohortQuantileRealDataResult:
    status: str
    reason: Optional[str]
    evidence_lineage: Optional[str]
    total_rows: Optional[int]
    evaluated_rows: Optional[int]
    p10_empirical_coverage: Optional[float]
    p25_empirical_coverage: Optional[float]
    p50_empirical_coverage: Optional[float]


def run_cohort_quantile_real_data_study(export: Optional[Mapping[str, Any]]) -> CohortQuantileRealDataResult:
    status, reason, rows = _validate_envelope(export, CONTINUOUS_TARGET_EXPORT_CONTRACT_VERSION)
    if status != "LOADED" or rows is None:
        return CohortQuantileRealDataResult(
            status=status, reason=reason, evidence_lineage=None, total_rows=None,
            evaluated_rows=None, p10_empirical_coverage=None, p25_empirical_coverage=None,
            p50_empirical_coverage=None,
        )
    input_rows = [
        CohortQuantileInputRow(
            episode_id=row["episodeId"], cohort_key=row["cohortKey"],
            decision_date=date.fromisoformat(row["decisionDate"]),
            # A censored/excluded export row must carry labelAvailableAt=null -- this runner
            # trusts that field as-is (never derives maturity itself) and passes forwardMae
            # through unchanged; the cohort-quantile module's own embargo logic is what refuses
            # to fold an unmatured row into any other row's history.
            label_available_at=date.fromisoformat(row["labelAvailableAt"]) if row.get("labelAvailableAt") else None,
            forward_mae=row.get("forwardMae"),
        )
        for row in rows
    ]
    evaluations = evaluate_cohort_quantile_baseline(input_rows)
    summary = summarize_cohort_quantile_coverage(evaluations)
    return CohortQuantileRealDataResult(
        status="COMPLETED", reason=None, evidence_lineage="REAL_EXPORT",
        total_rows=summary.total_rows, evaluated_rows=summary.evaluated_rows,
        p10_empirical_coverage=summary.p10_empirical_coverage,
        p25_empirical_coverage=summary.p25_empirical_coverage,
        p50_empirical_coverage=summary.p50_empirical_coverage,
    )


@dataclass(frozen=True)
class LogisticBaselineRealDataResult:
    status: str
    reason: Optional[str]
    evidence_lineage: Optional[str]
    train_n: Optional[int]
    test_n: Optional[int]
    oos_brier_score: Optional[float]
    oos_log_loss: Optional[float]
    oos_expected_calibration_error: Optional[float]


MIN_ROWS_FOR_LOGISTIC_BASELINE = 40


def run_logistic_baseline_real_data_study(
    export: Optional[Mapping[str, Any]], l2_penalty: float = 1.0, test_fraction: float = 0.3,
) -> LogisticBaselineRealDataResult:
    status, reason, rows = _validate_envelope(export, BINARY_LABEL_EXPORT_CONTRACT_VERSION)
    if status != "LOADED" or rows is None:
        return LogisticBaselineRealDataResult(
            status=status, reason=reason, evidence_lineage=None, train_n=None, test_n=None,
            oos_brier_score=None, oos_log_loss=None, oos_expected_calibration_error=None,
        )
    if len(rows) < MIN_ROWS_FOR_LOGISTIC_BASELINE:
        return LogisticBaselineRealDataResult(
            status="TEMPORAL_HISTORY_INSUFFICIENT", reason="FEWER_ROWS_THAN_MIN_ROWS_FOR_LOGISTIC_BASELINE",
            evidence_lineage="REAL_EXPORT", train_n=None, test_n=None,
            oos_brier_score=None, oos_log_loss=None, oos_expected_calibration_error=None,
        )
    # A row whose label never matured (no labelAvailableAt) is excluded here, before it ever
    # reaches chronological_train_test_split -- LogisticTrainingRow.label is documented as
    # "never a censored row," matching severe_drawdown_dataset.py's own binary contract.
    dated_rows: List[DatedLogisticRow] = [
        DatedLogisticRow(
            decision_date_iso=row["decisionDate"], label_available_at_iso=row["labelAvailableAt"],
            row=LogisticTrainingRow(features=tuple(row["features"]), label=int(row["label"])),
        )
        for row in rows if row.get("labelAvailableAt")
    ]
    train, test = chronological_train_test_split(dated_rows, test_fraction=test_fraction)
    fit = fit_logistic_regression(list(train), l2_penalty=l2_penalty)
    predicted = [predict_probability(fit, row.features) for row in test]
    actual = [row.label for row in test]
    calibration = evaluate_calibration(predicted, actual)
    return LogisticBaselineRealDataResult(
        status="COMPLETED", reason=None, evidence_lineage="REAL_EXPORT",
        train_n=len(train), test_n=len(test), oos_brier_score=calibration.brier_score,
        oos_log_loss=calibration.log_loss, oos_expected_calibration_error=calibration.expected_calibration_error,
    )
