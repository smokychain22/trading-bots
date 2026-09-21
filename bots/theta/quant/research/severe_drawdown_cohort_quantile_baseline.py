"""Empirical cohort tail-quantile baseline (directive Item B, section 6, tier 1).

Per the directive: "empirical cohort quantiles -> quantile regression -> GBM
quantile challenger, only if justified." This module implements ONLY the
first tier -- the simplest defensible baseline -- and does not build a
quantile-regression or GBM challenger, since neither has been justified by
any empirical result yet (no real historical dataset exists in this
session; see the module docstring in `severe_drawdown_continuous_target.py`).

Chronological, walk-forward, EMBARGOED evaluation: a row's cohort quantile
is computed from ONLY other rows whose OUTCOME had actually MATURED --
`label_available_at <= this row's decision_date` -- by that decision date.
This is a repair for a defect Codex's A-D acceptance review found
(docs/research/THETA_CLAUDE_A_D_ACCEPTANCE_2026-09-21.md, item B):
"Decision-date ordering is not enough when prior labels have not matured."
The PRIOR version of this module folded a row into history as soon as its
own decision_date had passed, regardless of whether its forward-looking
horizon had actually finished -- which could use a still-unrealized
outcome as if it were already known. `label_available_at` mirrors the
naming convention Codex's own canonical `severe_drawdown_dataset.py` uses
(`MaterializedSevereDrawdownRow.label_available_at`) for exactly this
concept, so the two modules describe outcome maturity the same way.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import List, Optional, Sequence, Tuple

MIN_PRIOR_ROWS_FOR_COHORT_QUANTILE = 20


@dataclass(frozen=True)
class CohortQuantileInputRow:
    episode_id: str
    cohort_key: str
    decision_date: date
    # The date this row's own forward_mae outcome actually became fully
    # known/matured (mirrors severe_drawdown_dataset.py's
    # label_available_at). None if the outcome never matured within the
    # dataset (still censored) -- such a row is NEVER folded into any
    # other row's history and is itself always INSUFFICIENT_PRIOR_HISTORY.
    label_available_at: Optional[date]
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
    """Embargoed walk-forward: for each row R, only OTHER rows in the same
    cohort whose `label_available_at` is not None and is STRICTLY BEFORE
    `R.decision_date` are eligible as history -- i.e. their outcome had
    genuinely matured (the full forward-looking horizon had elapsed and
    produced a final, non-censored forward_mae) by the time R's own
    decision was made. Strict inequality (never `<=`) means a row whose
    label matured on the SAME date as R's decision is not treated as known
    "in time" -- the safer, more conservative reading of "matured before
    this decision." A row
    with `label_available_at is None` (never matured / still censored as
    of the dataset horizon) never contributes to any other row's history,
    and is itself always reported INSUFFICIENT_PRIOR_HISTORY regardless of
    how many mature neighbors exist, since a censored outcome is not a
    quantity that can be "predicted" -- it's simply unresolved.

    A row NEVER counts itself as its own history. Uses a full-pool filter
    per evaluated row (not an incremental fold) since embargo eligibility
    depends on `label_available_at`, not `decision_date` ordering alone --
    a later-decided row can mature EARLIER than an earlier-decided row
    with a longer horizon, so no single chronological fold order is valid
    for every cohort simultaneously.
    """
    ordered = sorted(rows, key=lambda row: (row.decision_date, row.episode_id))
    results: List[CohortQuantileEvaluation] = []

    for row in ordered:
        eligible_history = sorted(
            other.forward_mae for other in ordered
            if other.episode_id != row.episode_id
            and other.cohort_key == row.cohort_key
            and other.label_available_at is not None
            and other.forward_mae is not None
            and other.label_available_at < row.decision_date
        )
        prior_n = len(eligible_history)

        if row.forward_mae is None or row.label_available_at is None:
            # This row's own outcome never matured (censored/excluded) --
            # it cannot be evaluated as a realized outcome, regardless of
            # how much eligible history exists for other rows.
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
                predicted_p10=_quantile(eligible_history, 0.10),
                predicted_p25=_quantile(eligible_history, 0.25),
                predicted_p50=_quantile(eligible_history, 0.50),
                actual_forward_mae=row.forward_mae,
            ))

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
