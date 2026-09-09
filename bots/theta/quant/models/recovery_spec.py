"""Recovery model specification: formalizes S_recovery(t) and its derived
quantities, without fitting anything -- no historical recovery dataset
exists yet (Phase 6 blocks the actual survival-model fit).

What this module provides now:

- ``RecoveryBasis``: the recovery target is tied to an economically
  meaningful basis (assignment/economic cost basis per share, per the
  instruction "not merely 'price increased'"), never the raw entry price
  alone -- a stock assigned at a discount to its option premium has already
  "recovered" in an economic sense before the raw price returns to the
  strike, and this module makes that basis an explicit, named choice
  rather than an implicit assumption.
- Pure survival-curve utilities: given ANY survival function S(t) (as a
  sequence of (t, S(t)) samples, however it was produced -- Kaplan-Meier,
  a parametric fit, or a synthetic fixture in tests), compute
  P(recovery <= t), median recovery, P95 recovery, and flag whether a
  query point is unresolved/censored in the underlying sample. These
  utilities have no model-fitting logic; they only consume a curve.

TRD anchors: section 43 (S_recovery(t), RecoveryMedian), section 46
(recovery label: time-to-approved-recovery or censoring).
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Tuple


class RecoveryBasis(str, Enum):
    """Which economic quantity "recovery" is measured against. The research
    brief requires this to be explicit, not "price increased" by default.
    """

    ORIGINAL_STRIKE_PRICE = "ORIGINAL_STRIKE_PRICE"  # raw price back to the CSP strike
    ASSIGNMENT_ECONOMIC_BASIS = "ASSIGNMENT_ECONOMIC_BASIS"  # strike minus entry premium collected (net cost basis)
    WHOLE_CHAIN_BREAKEVEN = "WHOLE_CHAIN_BREAKEVEN"  # net cost basis further adjusted for any CC premium already collected


@dataclass(frozen=True)
class SurvivalPoint:
    t_days: float
    survival_probability: float  # S(t) = P(recovery time > t), in [0, 1]


@dataclass(frozen=True)
class RecoverySummary:
    basis: RecoveryBasis
    p_recovery_by_5d: Optional[float]
    p_recovery_by_10d: Optional[float]
    p_recovery_by_20d: Optional[float]
    median_recovery_days: Optional[float]  # None if the curve never drops to <= 0.5 within its observed range
    p95_recovery_days: Optional[float]  # None if the curve never drops to <= 0.05 within its observed range
    unresolved_beyond_observed_range: bool  # True if the last known S(t) is still > 0 -- i.e. censored tail


def _validate_curve(curve: Sequence[SurvivalPoint]) -> List[SurvivalPoint]:
    if not curve:
        raise ValueError("survival curve must have at least one point")
    ordered = sorted(curve, key=lambda p: p.t_days)
    for p in ordered:
        if not (0.0 <= p.survival_probability <= 1.0):
            raise ValueError(f"survival_probability out of [0,1] at t={p.t_days}: {p.survival_probability}")
    for a, b in zip(ordered, ordered[1:]):
        if b.survival_probability > a.survival_probability:
            raise ValueError(
                f"survival curve must be non-increasing: S({a.t_days})={a.survival_probability} "
                f"< S({b.t_days})={b.survival_probability}"
            )
    return ordered


def _survival_at(curve: Sequence[SurvivalPoint], t_days: float) -> Optional[float]:
    """Step-function lookup: S(t) = the survival probability at the last
    observed point with t_days <= the query. Returns None if the query is
    before the first observed point (undefined, not assumed to be 1.0)."""
    candidates = [p for p in curve if p.t_days <= t_days]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.t_days).survival_probability


def _first_crossing(curve: Sequence[SurvivalPoint], threshold: float) -> Optional[float]:
    """inf{t : S(t) <= threshold}, per TRD section 43's RecoveryMedian
    definition generalized to an arbitrary threshold. Returns None if the
    curve never reaches the threshold within its observed range (i.e. the
    quantile is censored, not "infinite" or "never")."""
    for p in curve:
        if p.survival_probability <= threshold:
            return p.t_days
    return None


def summarize_recovery(
    curve: Sequence[SurvivalPoint], basis: RecoveryBasis
) -> RecoverySummary:
    """Computes the standard recovery-distribution summary from any
    already-produced survival curve. Does not fit or estimate the curve
    itself -- that is explicitly out of scope until a real dataset exists.
    """
    ordered = _validate_curve(curve)

    s5 = _survival_at(ordered, 5)
    s10 = _survival_at(ordered, 10)
    s20 = _survival_at(ordered, 20)

    p5 = (1.0 - s5) if s5 is not None else None
    p10 = (1.0 - s10) if s10 is not None else None
    p20 = (1.0 - s20) if s20 is not None else None

    median = _first_crossing(ordered, 0.5)
    p95 = _first_crossing(ordered, 0.05)

    last_point = ordered[-1]
    unresolved = last_point.survival_probability > 0.0

    return RecoverySummary(
        basis=basis,
        p_recovery_by_5d=p5,
        p_recovery_by_10d=p10,
        p_recovery_by_20d=p20,
        median_recovery_days=median,
        p95_recovery_days=p95,
        unresolved_beyond_observed_range=unresolved,
    )
