"""Severe-drawdown label specification: P(severe_drawdown | state, underlying, horizon).

This module does NOT fit a model -- per instruction, no ML until the
historical point-in-time dataset exists (Phase 6). What it formalizes now:

- the exact label definition (horizon, drawdown threshold families,
  censoring/overlap handling, the independence-clustering unit, and
  leakage guards), so that whenever a real dataset is built, every
  session constructs the *same* label rather than re-inventing it ad hoc;
- a pure, deterministic label-computation function that a future dataset
  builder can call per point-in-time episode, given an already-fetched
  price path -- this function does no I/O and fetches nothing itself.

TRD anchors: LABEL-001/002 (point-in-time, no future leakage), section 43
(P_SevereDrawdown), section 46 (dataset construction discipline).
"""

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import List, Optional, Sequence, Tuple


class DrawdownThresholdFamily(str, Enum):
    """Multiple threshold definitions are kept distinct rather than
    collapsed into one arbitrary "severe" cutoff -- which family is most
    economically meaningful is itself a TEST question."""

    PERCENT_FROM_ENTRY = "PERCENT_FROM_ENTRY"  # e.g. price falls X% below entry/strike
    PERCENT_FROM_STRIKE = "PERCENT_FROM_STRIKE"  # relevant specifically for assignment scenarios
    MULTIPLE_OF_RV = "MULTIPLE_OF_RV"  # drawdown expressed in realized-vol units, regime-adjusted
    ABSOLUTE_DOLLAR = "ABSOLUTE_DOLLAR"  # rarely appropriate across tickers, included for completeness


class LabelStatus(str, Enum):
    BREACHED = "BREACHED"  # threshold breached within horizon
    SURVIVED = "SURVIVED"  # horizon fully observed, threshold never breached
    CENSORED = "CENSORED"  # horizon extends past the dataset cutoff -- outcome unknown, not a negative


@dataclass(frozen=True)
class SevereDrawdownLabelSpec:
    """The versioned label definition. Every field is required -- there is
    no default horizon or threshold baked into this module (TRD section 51:
    risk/research parameters are versioned configuration).
    """

    spec_version: str
    horizon_days: int
    threshold_family: DrawdownThresholdFamily
    threshold_value: float  # interpretation depends on threshold_family
    # Independence/clustering unit: episodes sharing this key are NOT
    # treated as independent samples during validation (TRD: overlapping
    # same-ticker/same-day Wheel episodes are clustered, not independent).
    clustering_unit: str = "underlying_symbol_and_overlapping_window"


@dataclass(frozen=True)
class PricePoint:
    as_of: date
    price: float


@dataclass(frozen=True)
class SevereDrawdownLabelResult:
    status: LabelStatus
    breach_date: Optional[date]
    worst_drawdown_observed: float  # negative-or-zero fraction; meaningful even if not breached
    observed_through: date  # last date actually used (never past dataset_cutoff)


def compute_severe_drawdown_label(
    entry_price: float,
    entry_date: date,
    price_path: Sequence[PricePoint],
    spec: SevereDrawdownLabelSpec,
    dataset_cutoff: date,
) -> SevereDrawdownLabelResult:
    """Computes one point-in-time severe-drawdown label.

    Leakage guard: only ``price_path`` points with ``as_of <= dataset_cutoff``
    are ever examined, and only up to ``entry_date + horizon_days`` -- a
    price point beyond either bound is never read, regardless of what the
    caller passed in, so a caller cannot accidentally leak future data by
    over-supplying a longer path than the label needs.
    """
    if spec.threshold_family != DrawdownThresholdFamily.PERCENT_FROM_ENTRY:
        # Only one family is implemented so far -- the others are named in
        # the enum for the spec's completeness (so the label vocabulary is
        # fixed now) but their exact computation is deferred until a
        # concrete need is validated, rather than guessed here.
        raise NotImplementedError(
            f"{spec.threshold_family} is specified but not yet implemented; "
            "only PERCENT_FROM_ENTRY is computed by this v0 function."
        )

    horizon_end = _add_days(entry_date, spec.horizon_days)
    effective_end = min(horizon_end, dataset_cutoff)

    relevant_points = [p for p in price_path if entry_date <= p.as_of <= effective_end]
    relevant_points.sort(key=lambda p: p.as_of)

    worst_drawdown = 0.0
    breach_date: Optional[date] = None
    observed_through = entry_date

    for point in relevant_points:
        drawdown = (point.price - entry_price) / entry_price
        if drawdown < worst_drawdown:
            worst_drawdown = drawdown
        observed_through = point.as_of
        if breach_date is None and drawdown <= -abs(spec.threshold_value):
            breach_date = point.as_of

    if breach_date is not None:
        return SevereDrawdownLabelResult(
            status=LabelStatus.BREACHED,
            breach_date=breach_date,
            worst_drawdown_observed=worst_drawdown,
            observed_through=observed_through,
        )

    if horizon_end > dataset_cutoff:
        return SevereDrawdownLabelResult(
            status=LabelStatus.CENSORED,
            breach_date=None,
            worst_drawdown_observed=worst_drawdown,
            observed_through=observed_through,
        )

    return SevereDrawdownLabelResult(
        status=LabelStatus.SURVIVED,
        breach_date=None,
        worst_drawdown_observed=worst_drawdown,
        observed_through=observed_through,
    )


def _add_days(d: date, days: int) -> date:
    from datetime import timedelta
    return d + timedelta(days=days)
