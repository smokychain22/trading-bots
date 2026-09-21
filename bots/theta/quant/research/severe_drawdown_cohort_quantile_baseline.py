"""Empirical cohort tail-quantile baseline (directive Item B, section 6, tier 1).

Per the directive: "empirical cohort quantiles -> quantile regression -> GBM
quantile challenger, only if justified." This module implements ONLY the
first tier -- the simplest defensible baseline -- and does not build a
quantile-regression or GBM challenger, since neither has been justified by
any empirical result yet (no real historical dataset exists in this
session; see the module docstring in `severe_drawdown_continuous_target.py`).

Chronological, walk-forward evaluation only: a row's cohort quantile is
computed from ONLY rows whose `decision_date` is strictly before that row's
own `decision_date` (never using same-day or future rows, and never a
single in-sample fit reused for all rows -- that would leak future
distribution shape into an "evaluation").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional, Sequence, Tuple

MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE = 20


@dataclass(frozen=True)
class CohortQuantileInputRow:
    episode_id: str
    cohort_key: str
    decision_date: date
    forward_mae: Optional[float]  # None (censored/excluded) rows are never used to fit a quantile


@dataclass(frozen=True)
class CohortQuantileEvaluation:
    episode_id: str
    cohort_key: str
    decision_date: date
    prior_n: int
    status: str  # 'EVALUATED' | 'INSUFFICIENT_PRIOR_HISTORY'
    predicted_p10: Optional[float]
    predicted_p25: Optional[float]
    predicted_p50: Optional[float]
    actual_forward_mae: Optional[float]


def _quantile(sorted_values: Sequence[float], q: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = q * (len(sorted_values) - 1)
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = position - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def evaluate_cohort_quantile_baseline(
    rows: Sequence[CohortQuantileInputRow],
) -> Tuple[CohortQuantileEvaluation, ...]:
    """Walk-forward: sorts all rows chronologically, then for each row
    computes p10/p25/p50 of `forward_mae` using only STRICTLY PRIOR rows
    sharing the same `cohort_key`. Rows with `forward_mae is None` (censored
    or excluded episodes) are never used as either a predictor input or an
    evaluation target.
    """
    ordered = sorted(rows, key=lambda row: (row.decision_date, row.episode_id))
    history_by_cohort: Dict[str, List[float]] = {}
    results: List[CohortQuantileEvaluation] = []

    # Process one decision_date at a time: every row sharing today's date is
    # evaluated against history frozen as of the END of the PRIOR date, and
    # none of today's own rows are folded into history until every row for
    # today has been evaluated. This is what makes "prior" mean strictly
    # earlier dates, not merely earlier in an arbitrary same-day ordering.
    index = 0
    while index < len(ordered):
        current_date = ordered[index].decision_date
        todays_rows = []
        while index < len(ordered) and ordered[index].decision_date == current_date:
            todays_rows.append(ordered[index])
            index += 1

        for row in todays_rows:
            prior_values = sorted(history_by_cohort.get(row.cohort_key, []))
            prior_n = len(prior_values)
            if row.forward_mae is None:
                results.append(CohortQuantileEvaluation(
                    episode_id=row.episode_id, cohort_key=row.cohort_key, decision_date=row.decision_date,
                    prior_n=prior_n, status="INSUFFICIENT_PRIOR_HISTORY", predicted_p10=None,
                    predicted_p25=None, predicted_p50=None, actual_forward_mae=None,
                ))
            elif prior_n < MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE:
                results.append(CohortQuantileEvaluation(
                    episode_id=row.episode_id, cohort_key=row.cohort_key, decision_date=row.decision_date,
                    prior_n=prior_n, status="INSUFFICIENT_PRIOR_HISTORY", predicted_p10=None,
                    predicted_p25=None, predicted_p50=None, actual_forward_mae=row.forward_mae,
                ))
            else:
                results.append(CohortQuantileEvaluation(
                    episode_id=row.episode_id, cohort_key=row.cohort_key, decision_date=row.decision_date,
                    prior_n=prior_n, status="EVALUATED",
                    predicted_p10=_quantile(prior_values, 0.10),
                    predicted_p25=_quantile(prior_values, 0.25),
                    predicted_p50=_quantile(prior_values, 0.50),
                    actual_forward_mae=row.forward_mae,
                ))

        # Only NOW, after every row dated `current_date` has been evaluated
        # against yesterday-or-earlier history, fold today's known values in.
        for row in todays_rows:
            if row.forward_mae is not None:
                history_by_cohort.setdefault(row.cohort_key, []).append(row.forward_mae)

    return tuple(results)


@dataclass(frozen=True)
class CohortQuantileCoverageSummary:
    total_rows: int
    evaluated_rows: int
    insufficient_history_rows: int
    # Empirical coverage: fraction of EVALUATED rows whose actual value fell
    # at or below the predicted p10/p25/p50 -- should track ~0.10/0.25/0.50
    # if the quantile baseline is well-calibrated. Reported, never enforced.
    p10_empirical_coverage: Optional[float]
    p25_empirical_coverage: Optional[float]
    p50_empirical_coverage: Optional[float]


def summarize_cohort_quantile_coverage(evaluations: Sequence[CohortQuantileEvaluation]) -> CohortQuantileCoverageSummary:
    evaluated = [row for row in evaluations if row.status == "EVALUATED"]
    def coverage(predicted_attr: str) -> Optional[float]:
        if not evaluated:
            return None
        hits = sum(
            1 for row in evaluated
            if row.actual_forward_mae is not None and getattr(row, predicted_attr) is not None
            and row.actual_forward_mae <= getattr(row, predicted_attr)
        )
        return hits / len(evaluated)
    return CohortQuantileCoverageSummary(
        total_rows=len(evaluations), evaluated_rows=len(evaluated),
        insufficient_history_rows=len(evaluations) - len(evaluated),
        p10_empirical_coverage=coverage("predicted_p10"),
        p25_empirical_coverage=coverage("predicted_p25"),
        p50_empirical_coverage=coverage("predicted_p50"),
    )
