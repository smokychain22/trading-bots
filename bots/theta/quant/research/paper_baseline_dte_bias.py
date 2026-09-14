"""Paper baseline DTE-bias diagnostic (RESEARCH_CHALLENGER B).

Resolves the standing challenger: Codex's `theta-paper-active-baseline-v2`
ranks candidates primarily by `structuralPremiumReturnPerCapitalDay =
premium/(collateral*dte)`, which under standard Black-Scholes ATM
time-scaling (`premium/collateral ~ sqrt(T)`) mathematically favors short
DTE (`~1/sqrt(T)`), independent of any genuine economic edge. This module
is the diagnostic that AUTOMATICALLY answers the question the moment real
`theta_paper_active_baseline_receipt` rows exist: does the resulting
dataset in fact skew short-DTE, and by how much, across the funnel stages
(raw candidates -> Pareto frontier -> selected -> near-miss)?

Built now, deliberately, per the standing "build the diagnostic before the
data arrives" instruction -- it does not run against anything until real
receipts are supplied, and produces no number until then.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

#: The canonical THETA DTE buckets this diagnostic reports against,
#: matching `experiment_registry.DTE_BINS` plus the wider practitioner
#: range this run's directive named (short-DTE specialist territory
#: included, since the whole point is to detect a skew toward it).
DTE_BUCKETS: Tuple[Tuple[str, int, int], ...] = (
    ("2_5", 2, 5),
    ("6_14", 6, 14),
    ("15_24", 15, 24),
    ("25_35", 25, 35),
    ("36_45", 36, 45),
    ("46_60", 46, 60),
    ("60_PLUS", 61, 10_000),
)


def bucket_for_dte(dte: int) -> Optional[str]:
    """Returns the bucket label for a given DTE, or None if `dte` is
    non-positive (never silently assigned to a bucket it doesn't belong
    in)."""
    if dte <= 0:
        return None
    for label, low, high in DTE_BUCKETS:
        if low <= dte <= high:
            return label
    return None


@dataclass(frozen=True)
class BaselineReceiptCandidateRecord:
    """One candidate's role in one baseline-selection receipt --
    the minimal shape this diagnostic needs, deliberately narrow so it
    can be built from `theta_paper_active_baseline_receipt`/
    `candidate_assessments_json` without inventing a new export schema."""

    candidate_id: str
    dte: int
    eligible: bool  # passed structural hard blockers
    on_pareto_frontier: bool
    selected: bool
    structural_premium_return_per_capital_day: Optional[float]


@dataclass(frozen=True)
class NearMissRecord:
    candidate_id: str
    dte: int


@dataclass(frozen=True)
class DteBucketDistribution:
    bucket: str
    raw_candidate_count: int
    eligible_count: int
    frontier_count: int
    selected_count: int
    near_miss_count: int
    mean_structural_return: Optional[float]


@dataclass(frozen=True)
class DteBiasDiagnosticReport:
    """The complete report this module exists to produce the moment real
    receipts exist. `sufficient_receipts` gates whether `skew_detected`
    is a real conclusion or `None` (never guessed from too little data)."""

    total_receipts: int
    minimum_receipts_required: int
    sufficient_receipts: bool
    buckets: List[DteBucketDistribution]
    selected_share_short_dte: Optional[float]  # fraction of ALL selections falling in the 2-5/6-14 buckets
    selected_share_target_cohort: Optional[float]  # fraction falling in 25-35/36-45 (the existing hypothesis registry's own cohort)
    skew_detected: Optional[bool]  # None until sufficient_receipts; True if selected_share_short_dte far exceeds raw_candidate share in those buckets


def _mean(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def build_dte_bias_report(
    candidates_by_receipt: Sequence[Sequence[BaselineReceiptCandidateRecord]],
    near_misses_by_receipt: Sequence[Sequence[NearMissRecord]],
    minimum_receipts_required: int,
    skew_share_difference_threshold: float,
) -> DteBiasDiagnosticReport:
    """Builds the full DTE-bucket funnel report across many receipts.
    `minimum_receipts_required` and `skew_share_difference_threshold` are
    REQUIRED, caller-supplied -- no invented default sample size or
    skew-significance threshold, per the standing no-invented-threshold
    discipline. This function performs pure aggregation; it never touches
    Production or fabricates a receipt."""
    total_receipts = len(candidates_by_receipt)
    sufficient = total_receipts >= minimum_receipts_required

    bucket_raw: Dict[str, List[BaselineReceiptCandidateRecord]] = {label: [] for label, _, _ in DTE_BUCKETS}
    bucket_near_miss: Dict[str, int] = {label: 0 for label, _, _ in DTE_BUCKETS}

    for receipt_candidates in candidates_by_receipt:
        for candidate in receipt_candidates:
            bucket = bucket_for_dte(candidate.dte)
            if bucket is not None:
                bucket_raw[bucket].append(candidate)
    for receipt_near_misses in near_misses_by_receipt:
        for near_miss in receipt_near_misses:
            bucket = bucket_for_dte(near_miss.dte)
            if bucket is not None:
                bucket_near_miss[bucket] += 1

    buckets: List[DteBucketDistribution] = []
    total_selected = 0
    selected_short_dte = 0
    selected_target_cohort = 0
    for label, _, _ in DTE_BUCKETS:
        members = bucket_raw[label]
        eligible = [c for c in members if c.eligible]
        frontier = [c for c in members if c.on_pareto_frontier]
        selected = [c for c in members if c.selected]
        returns = [c.structural_premium_return_per_capital_day for c in members if c.structural_premium_return_per_capital_day is not None]
        buckets.append(DteBucketDistribution(
            bucket=label, raw_candidate_count=len(members), eligible_count=len(eligible),
            frontier_count=len(frontier), selected_count=len(selected),
            near_miss_count=bucket_near_miss[label], mean_structural_return=_mean(returns),
        ))
        total_selected += len(selected)
        if label in ("2_5", "6_14"):
            selected_short_dte += len(selected)
        if label in ("25_35", "36_45"):
            selected_target_cohort += len(selected)

    if not sufficient or total_selected == 0:
        return DteBiasDiagnosticReport(
            total_receipts=total_receipts, minimum_receipts_required=minimum_receipts_required,
            sufficient_receipts=sufficient, buckets=buckets,
            selected_share_short_dte=None, selected_share_target_cohort=None, skew_detected=None,
        )

    selected_share_short_dte = selected_short_dte / total_selected
    selected_share_target_cohort = selected_target_cohort / total_selected
    total_raw = sum(b.raw_candidate_count for b in buckets)
    raw_share_short_dte = (
        sum(b.raw_candidate_count for b in buckets if b.bucket in ("2_5", "6_14")) / total_raw
        if total_raw > 0 else None
    )
    skew_detected = (
        None if raw_share_short_dte is None
        else (selected_share_short_dte - raw_share_short_dte) > skew_share_difference_threshold
    )
    return DteBiasDiagnosticReport(
        total_receipts=total_receipts, minimum_receipts_required=minimum_receipts_required,
        sufficient_receipts=True, buckets=buckets,
        selected_share_short_dte=selected_share_short_dte,
        selected_share_target_cohort=selected_share_target_cohort,
        skew_detected=skew_detected,
    )
