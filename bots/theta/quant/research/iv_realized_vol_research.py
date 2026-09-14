"""Implied-vs-realized volatility research (R6 item 7).

Dependency-free (no numpy). Implements four standard realized-volatility
estimators (close-to-close, Parkinson, Garman-Klass, Rogers-Satchell) with
EXPLICIT horizon/annualization bookkeeping, plus IV-RV comparison
quantities that refuse to compute unless both sides share the same
horizon and annualization convention. No estimator is chosen because it
"sounds more sophisticated" -- close-to-close is the simple baseline; the
others are challengers, each requiring OHLC data the simpler estimator
does not, and each carrying its own well-known statistical-efficiency/
jump-sensitivity tradeoff documented on its own dataclass.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence


TRADING_DAYS_PER_YEAR = 252  # standard equity/index annualization convention; documented, not hidden


class RvEstimatorMethod(str, Enum):
    CLOSE_TO_CLOSE = "CLOSE_TO_CLOSE"  # simplest baseline; needs only closing prices
    PARKINSON = "PARKINSON"  # uses high/low; more efficient than close-to-close, assumes no drift, no overnight/jump
    GARMAN_KLASS = "GARMAN_KLASS"  # uses OHLC; more efficient still, assumes no drift, still jump-sensitive
    ROGERS_SATCHELL = "ROGERS_SATCHELL"  # uses OHLC; unlike the above two, allows for nonzero drift


@dataclass(frozen=True)
class OhlcBar:
    """One PIT-valid daily bar. `date` exists only for ordering/labeling by
    the caller -- this module performs no lookahead of its own; the caller
    must supply only bars with `date < decision_time`."""

    date: str
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class RealizedVolatilityEstimate:
    method: RvEstimatorMethod
    annualized_volatility: Optional[float]  # decimal (e.g. 0.25 = 25%), annualized using TRADING_DAYS_PER_YEAR
    trading_days_per_year_convention: int
    sample_size_days: int
    minimum_sample_size_required: int
    evidence_state: str  # "ESTIMATED" | "INSUFFICIENT_DATA" | "INVALID_BAR_DATA"


def _valid_bar(bar: OhlcBar) -> bool:
    return (
        all(math.isfinite(v) and v > 0 for v in (bar.open, bar.high, bar.low, bar.close))
        and bar.low <= bar.open <= bar.high
        and bar.low <= bar.close <= bar.high
    )


def close_to_close_rv(bars: Sequence[OhlcBar], minimum_sample_size: int) -> RealizedVolatilityEstimate:
    """The simple baseline: annualized stddev of daily log returns.
    `minimum_sample_size` is REQUIRED, caller-supplied -- no invented
    default minimum, per the standing no-invented-threshold discipline."""
    if any(not _valid_bar(bar) for bar in bars):
        return RealizedVolatilityEstimate(RvEstimatorMethod.CLOSE_TO_CLOSE, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    returns = [math.log(bars[i].close / bars[i - 1].close) for i in range(1, len(bars))]
    if len(returns) < minimum_sample_size:
        return RealizedVolatilityEstimate(RvEstimatorMethod.CLOSE_TO_CLOSE, None, TRADING_DAYS_PER_YEAR, len(returns), minimum_sample_size, "INSUFFICIENT_DATA")
    mean_return = sum(returns) / len(returns)
    variance = sum((r - mean_return) ** 2 for r in returns) / (len(returns) - 1)
    annualized = math.sqrt(variance * TRADING_DAYS_PER_YEAR)
    return RealizedVolatilityEstimate(RvEstimatorMethod.CLOSE_TO_CLOSE, annualized, TRADING_DAYS_PER_YEAR, len(returns), minimum_sample_size, "ESTIMATED")


def parkinson_rv(bars: Sequence[OhlcBar], minimum_sample_size: int) -> RealizedVolatilityEstimate:
    """Parkinson (1980): uses the high-low range, more statistically
    efficient than close-to-close under its own assumptions (continuous
    trading, no drift, no jumps -- both violated by real overnight gaps,
    so this estimator is a CHALLENGER, not a strict improvement)."""
    if any(not _valid_bar(bar) for bar in bars):
        return RealizedVolatilityEstimate(RvEstimatorMethod.PARKINSON, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    if len(bars) < minimum_sample_size:
        return RealizedVolatilityEstimate(RvEstimatorMethod.PARKINSON, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INSUFFICIENT_DATA")
    factor = 1.0 / (4.0 * math.log(2.0))
    daily_variances = [factor * math.log(bar.high / bar.low) ** 2 for bar in bars]
    mean_daily_variance = sum(daily_variances) / len(daily_variances)
    annualized = math.sqrt(mean_daily_variance * TRADING_DAYS_PER_YEAR)
    return RealizedVolatilityEstimate(RvEstimatorMethod.PARKINSON, annualized, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "ESTIMATED")


def garman_klass_rv(bars: Sequence[OhlcBar], minimum_sample_size: int) -> RealizedVolatilityEstimate:
    """Garman-Klass (1980): adds open/close information to Parkinson's
    high/low range for further efficiency gain under the same no-drift,
    no-jump assumptions."""
    if any(not _valid_bar(bar) for bar in bars):
        return RealizedVolatilityEstimate(RvEstimatorMethod.GARMAN_KLASS, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    if len(bars) < minimum_sample_size:
        return RealizedVolatilityEstimate(RvEstimatorMethod.GARMAN_KLASS, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INSUFFICIENT_DATA")
    daily_variances = []
    for bar in bars:
        hl = 0.5 * math.log(bar.high / bar.low) ** 2
        co = (2.0 * math.log(2.0) - 1.0) * math.log(bar.close / bar.open) ** 2
        daily_variances.append(hl - co)
    mean_daily_variance = sum(daily_variances) / len(daily_variances)
    if mean_daily_variance < 0:
        # A pathological/degenerate bar sequence can push the (unbiased,
        # not variance-positive-definite-by-construction) GK estimator
        # negative -- never silently sqrt a negative number.
        return RealizedVolatilityEstimate(RvEstimatorMethod.GARMAN_KLASS, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    annualized = math.sqrt(mean_daily_variance * TRADING_DAYS_PER_YEAR)
    return RealizedVolatilityEstimate(RvEstimatorMethod.GARMAN_KLASS, annualized, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "ESTIMATED")


def rogers_satchell_rv(bars: Sequence[OhlcBar], minimum_sample_size: int) -> RealizedVolatilityEstimate:
    """Rogers-Satchell (1991): unlike Parkinson/Garman-Klass, this
    estimator is drift-independent -- valid even when the underlying has a
    nonzero trend over the sample window, at the cost of remaining
    jump-sensitive like the others."""
    if any(not _valid_bar(bar) for bar in bars):
        return RealizedVolatilityEstimate(RvEstimatorMethod.ROGERS_SATCHELL, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    if len(bars) < minimum_sample_size:
        return RealizedVolatilityEstimate(RvEstimatorMethod.ROGERS_SATCHELL, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INSUFFICIENT_DATA")
    daily_variances = []
    for bar in bars:
        term = (
            math.log(bar.high / bar.close) * math.log(bar.high / bar.open)
            + math.log(bar.low / bar.close) * math.log(bar.low / bar.open)
        )
        daily_variances.append(term)
    mean_daily_variance = sum(daily_variances) / len(daily_variances)
    if mean_daily_variance < 0:
        return RealizedVolatilityEstimate(RvEstimatorMethod.ROGERS_SATCHELL, None, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "INVALID_BAR_DATA")
    annualized = math.sqrt(mean_daily_variance * TRADING_DAYS_PER_YEAR)
    return RealizedVolatilityEstimate(RvEstimatorMethod.ROGERS_SATCHELL, annualized, TRADING_DAYS_PER_YEAR, len(bars), minimum_sample_size, "ESTIMATED")


@dataclass(frozen=True)
class VrpComparison:
    """A volatility-risk-premium quantity, computed ONLY when both sides
    share an explicit, checked horizon and annualization convention.
    `horizon_mismatch_years` is the absolute difference between the IV's
    own implied horizon and the RV estimate's realized-sample horizon --
    non-zero means the two are NOT measuring the same forward-looking
    window, and every derived field below becomes None rather than
    comparing apples to oranges."""

    iv_annualized: Optional[float]
    rv_annualized: Optional[float]
    iv_horizon_years: float
    rv_horizon_years: float
    horizon_mismatch_years: float
    horizon_aligned: bool
    vrp_difference: Optional[float]  # IV - RV, decimal
    vrp_variance_difference: Optional[float]  # IV^2 - RV^2 (variance-space, not vol-space)
    vrp_ratio: Optional[float]  # IV / RV


def compute_vrp(
    iv_annualized: Optional[float], iv_horizon_years: float,
    rv_estimate: RealizedVolatilityEstimate, rv_horizon_years: float,
    horizon_tolerance_years: float,
) -> VrpComparison:
    """Computes VRP quantities ONLY when the IV horizon and the realized-
    sample horizon are within `horizon_tolerance_years` of each other
    (REQUIRED, caller-supplied -- no invented tolerance). A 30-day IV
    compared against a 252-day trailing RV is a well-known methodological
    error this function refuses to silently produce."""
    mismatch = abs(iv_horizon_years - rv_horizon_years)
    aligned = mismatch <= horizon_tolerance_years
    rv = rv_estimate.annualized_volatility
    if not aligned or iv_annualized is None or rv is None:
        return VrpComparison(
            iv_annualized=iv_annualized, rv_annualized=rv,
            iv_horizon_years=iv_horizon_years, rv_horizon_years=rv_horizon_years,
            horizon_mismatch_years=mismatch, horizon_aligned=aligned,
            vrp_difference=None, vrp_variance_difference=None, vrp_ratio=None,
        )
    return VrpComparison(
        iv_annualized=iv_annualized, rv_annualized=rv,
        iv_horizon_years=iv_horizon_years, rv_horizon_years=rv_horizon_years,
        horizon_mismatch_years=mismatch, horizon_aligned=True,
        vrp_difference=iv_annualized - rv,
        vrp_variance_difference=iv_annualized ** 2 - rv ** 2,
        vrp_ratio=(iv_annualized / rv) if rv > 0 else None,
    )


#: Every estimator, with its own documented assumption set -- callers
#: should run the ladder (close-to-close baseline first) rather than
#: reach for the most "sophisticated" one, per the standing discipline.
RV_ESTIMATOR_LADDER = (
    (RvEstimatorMethod.CLOSE_TO_CLOSE, close_to_close_rv),
    (RvEstimatorMethod.PARKINSON, parkinson_rv),
    (RvEstimatorMethod.GARMAN_KLASS, garman_klass_rv),
    (RvEstimatorMethod.ROGERS_SATCHELL, rogers_satchell_rv),
)
