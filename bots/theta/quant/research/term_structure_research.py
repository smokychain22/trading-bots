"""Term-structure research: multi-method comparison contract (RESEARCH_CHALLENGER A).

Resolves the standing challenger recorded in `R6_MEGA_PHASE_PARITY_
ADDENDUM.md`: Codex's production `deriveTerm` averages IV across every
listed strike/type at each expiration, which conflates a genuine
tenor (term) effect with a moneyness-mix artifact if the near and far
expirations have different strike coverage. This module builds every
term-structure method named in the standing directive so they can be
compared empirically once PIT-valid per-expiry chains exist -- it does
NOT declare a winner today, and none of the methods below is treated as
correct by construction. Dependency-free.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Sequence

from research.volatility_surface_research import RawSviParameters, raw_svi_total_variance


class TermMethod(str, Enum):
    ALL_STRIKE_MEAN = "ALL_STRIKE_MEAN"  # Codex's current production method: unweighted mean IV across every listed strike/type
    ATM_RELATIVE = "ATM_RELATIVE"  # nearest-to-spot strike per expiration only
    MATCHED_LOG_MONEYNESS = "MATCHED_LOG_MONEYNESS"  # same log-moneyness k sampled at both expirations
    PROVIDER_TERM_METRIC = "PROVIDER_TERM_METRIC"  # a term value the provider itself reports, if any
    TOTAL_VARIANCE = "TOTAL_VARIANCE"  # compares w(k,T) = IV^2 * T rather than raw IV
    FORWARD_VARIANCE = "FORWARD_VARIANCE"  # the variance attributable to holding from the near to the far expiry alone


@dataclass(frozen=True)
class TermQuotePoint:
    """One PIT-valid quoted option: expiration, strike, log-moneyness,
    option type, and IV. The caller computes `log_moneyness = ln(K/F)`
    itself from PIT-safe inputs."""

    expiration: str
    strike: float
    log_moneyness: float
    option_type: str  # 'PUT' | 'CALL'
    implied_volatility: float
    liquid: bool


@dataclass(frozen=True)
class TermStructureResult:
    method: TermMethod
    near_expiry: str
    far_expiry: str
    near_years_to_expiry: Optional[float]
    far_years_to_expiry: Optional[float]
    near_iv: Optional[float]
    far_iv: Optional[float]
    total_variance_near: Optional[float]
    total_variance_far: Optional[float]
    slope: Optional[float]  # far_iv - near_iv (raw-IV methods) or total-variance analogue
    missingness_note: str
    liquidity_note: str
    moneyness_match_error: Optional[float]  # |near_log_moneyness_used - far_log_moneyness_used|, None when not applicable


def _years(expiration_days: Optional[int]) -> Optional[float]:
    if expiration_days is None or expiration_days <= 0:
        return None
    return expiration_days / 365.0


def all_strike_mean_term(
    near_points: Sequence[TermQuotePoint], far_points: Sequence[TermQuotePoint],
    near_dte: Optional[int], far_dte: Optional[int],
) -> TermStructureResult:
    """Mirrors Codex's current production `deriveTerm`: an unweighted mean
    IV across EVERY listed point at each expiration, regardless of strike
    coverage differences between the two expirations. Reproduced here
    exactly so it can be compared against the alternatives below on
    identical input data."""
    near_ivs = [p.implied_volatility for p in near_points]
    far_ivs = [p.implied_volatility for p in far_points]
    if not near_ivs or not far_ivs:
        return TermStructureResult(
            TermMethod.ALL_STRIKE_MEAN, near_points[0].expiration if near_points else "", far_points[0].expiration if far_points else "",
            _years(near_dte), _years(far_dte), None, None, None, None, None,
            "NO_QUOTES_AT_ONE_OR_BOTH_EXPIRATIONS", "NOT_APPLICABLE", None,
        )
    near_iv = sum(near_ivs) / len(near_ivs)
    far_iv = sum(far_ivs) / len(far_ivs)
    return TermStructureResult(
        TermMethod.ALL_STRIKE_MEAN, near_points[0].expiration, far_points[0].expiration,
        _years(near_dte), _years(far_dte), near_iv, far_iv, None, None, far_iv - near_iv,
        "NONE" if near_ivs and far_ivs else "PARTIAL",
        f"STRIKE_COUNT_NEAR={len(near_points)}_FAR={len(far_points)}_UNMATCHED",
        None,
    )


def atm_relative_term(
    near_points: Sequence[TermQuotePoint], far_points: Sequence[TermQuotePoint],
    near_dte: Optional[int], far_dte: Optional[int],
) -> TermStructureResult:
    """Uses only the strike NEAREST to at-the-money (log-moneyness closest
    to zero) at each expiration -- avoids the all-strike method's
    moneyness-mix confound at the cost of discarding the rest of the
    chain's information."""
    near = min(near_points, key=lambda p: abs(p.log_moneyness), default=None)
    far = min(far_points, key=lambda p: abs(p.log_moneyness), default=None)
    if near is None or far is None:
        return TermStructureResult(
            TermMethod.ATM_RELATIVE, near_points[0].expiration if near_points else "", far_points[0].expiration if far_points else "",
            _years(near_dte), _years(far_dte), None, None, None, None, None,
            "NO_QUOTES_AT_ONE_OR_BOTH_EXPIRATIONS", "NOT_APPLICABLE", None,
        )
    return TermStructureResult(
        TermMethod.ATM_RELATIVE, near.expiration, far.expiration, _years(near_dte), _years(far_dte),
        near.implied_volatility, far.implied_volatility, None, None,
        far.implied_volatility - near.implied_volatility,
        "NONE", f"NEAR_LIQUID={near.liquid}_FAR_LIQUID={far.liquid}",
        abs(near.log_moneyness - far.log_moneyness),
    )


def matched_log_moneyness_term(
    near_points: Sequence[TermQuotePoint], far_points: Sequence[TermQuotePoint],
    near_dte: Optional[int], far_dte: Optional[int],
    target_log_moneyness: float, max_moneyness_distance: float,
) -> TermStructureResult:
    """Samples the SAME log-moneyness target at both expirations (e.g. k=0
    for ATM, or a fixed 25-delta-equivalent k). `max_moneyness_distance`
    is REQUIRED, caller-supplied -- refuses to match a point whose
    log-moneyness is farther than this from the target, rather than
    silently accepting an arbitrarily-far "closest available" point."""
    near_candidates = [p for p in near_points if abs(p.log_moneyness - target_log_moneyness) <= max_moneyness_distance]
    far_candidates = [p for p in far_points if abs(p.log_moneyness - target_log_moneyness) <= max_moneyness_distance]
    near = min(near_candidates, key=lambda p: abs(p.log_moneyness - target_log_moneyness), default=None)
    far = min(far_candidates, key=lambda p: abs(p.log_moneyness - target_log_moneyness), default=None)
    if near is None or far is None:
        return TermStructureResult(
            TermMethod.MATCHED_LOG_MONEYNESS, near_points[0].expiration if near_points else "", far_points[0].expiration if far_points else "",
            _years(near_dte), _years(far_dte), None, None, None, None, None,
            "NO_POINT_WITHIN_MONEYNESS_TOLERANCE_AT_ONE_OR_BOTH_EXPIRATIONS", "NOT_APPLICABLE", None,
        )
    return TermStructureResult(
        TermMethod.MATCHED_LOG_MONEYNESS, near.expiration, far.expiration, _years(near_dte), _years(far_dte),
        near.implied_volatility, far.implied_volatility, None, None,
        far.implied_volatility - near.implied_volatility,
        "NONE", f"NEAR_LIQUID={near.liquid}_FAR_LIQUID={far.liquid}",
        abs(near.log_moneyness - far.log_moneyness),
    )


def total_variance_term(
    near_iv: Optional[float], near_dte: Optional[int], far_iv: Optional[float], far_dte: Optional[int],
) -> TermStructureResult:
    """Compares TOTAL VARIANCE w(k,T) = IV^2 * T rather than raw IV -- the
    theoretically cleaner quantity for term-structure questions, since
    total variance (not IV itself) is additive across non-overlapping
    time intervals under standard no-arbitrage assumptions."""
    near_years, far_years = _years(near_dte), _years(far_dte)
    if near_iv is None or far_iv is None or near_years is None or far_years is None:
        return TermStructureResult(
            TermMethod.TOTAL_VARIANCE, "", "", near_years, far_years, near_iv, far_iv, None, None, None,
            "IV_OR_DTE_UNKNOWN", "NOT_APPLICABLE", None,
        )
    w_near = near_iv ** 2 * near_years
    w_far = far_iv ** 2 * far_years
    return TermStructureResult(
        TermMethod.TOTAL_VARIANCE, "", "", near_years, far_years, near_iv, far_iv, w_near, w_far, w_far - w_near,
        "NONE", "NOT_APPLICABLE", None,
    )


def provider_term_metric_result(
    slope: Optional[float], underlying: str, observed_at: str,
) -> TermStructureResult:
    """Wraps Codex's own provider-reported term-structure slope
    (`optionomics_context_metrics.provider_reported_term_slope`, sourced
    from `normalizeMetrics`'s confirmed `termSlope <- vol_term_structure_
    slope` mapping) as a `TermStructureResult` so it can sit directly
    alongside `ALL_STRIKE_MEAN`/`ATM_RELATIVE`/`MATCHED_LOG_MONEYNESS` in
    one `TermMethodComparison`. Unlike the other methods, this one carries
    no separate near/far IV or expiry of its own -- the provider reports
    only the aggregate slope -- so those fields stay None rather than
    fabricated from the single number."""
    return TermStructureResult(
        TermMethod.PROVIDER_TERM_METRIC, underlying, underlying, None, None, None, None, None, None,
        slope, "NONE" if slope is not None else "PROVIDER_TERM_SLOPE_UNKNOWN", "NOT_APPLICABLE", None,
    )


def forward_variance_term(
    near_iv: Optional[float], near_dte: Optional[int], far_iv: Optional[float], far_dte: Optional[int],
) -> Optional[float]:
    """The variance attributable to holding from the near expiry to the far
    expiry ALONE (the forward-start variance): `w_far - w_near`, expressed
    back as an annualized forward volatility over the [near, far] window.
    Returns None whenever the far total variance is not greater than the
    near total variance -- that is itself the calendar-arbitrage
    condition from `volatility_surface_research.check_calendar_arbitrage`,
    and a negative forward variance has no real square root."""
    near_years, far_years = _years(near_dte), _years(far_dte)
    if near_iv is None or far_iv is None or near_years is None or far_years is None or far_years <= near_years:
        return None
    w_near = near_iv ** 2 * near_years
    w_far = far_iv ** 2 * far_years
    forward_variance = w_far - w_near
    if forward_variance < 0:
        return None
    forward_window_years = far_years - near_years
    return math.sqrt(forward_variance / forward_window_years)


def surface_derived_term(near_fit: Optional[RawSviParameters], near_years: Optional[float],
                          far_fit: Optional[RawSviParameters], far_years: Optional[float],
                          log_moneyness: float) -> Optional[float]:
    """Reads near/far IV off two ALREADY-FITTED raw-SVI slices
    (`volatility_surface_research.fit_raw_svi`) at one shared
    log-moneyness -- the fitted-surface analogue of `matched_log_
    moneyness_term`, useful once real per-expiry fits exist. None when
    either slice has no fit."""
    if near_fit is None or far_fit is None or near_years is None or far_years is None or near_years <= 0 or far_years <= 0:
        return None
    near_iv = math.sqrt(max(raw_svi_total_variance(log_moneyness, near_fit), 0.0) / near_years)
    far_iv = math.sqrt(max(raw_svi_total_variance(log_moneyness, far_fit), 0.0) / far_years)
    return far_iv - near_iv


@dataclass(frozen=True)
class TermMethodComparison:
    """One session's side-by-side comparison across every method that
    successfully produced a result on the SAME underlying input data --
    the direct tool for answering "does the all-strike method actually
    agree with the moneyness-controlled ones, or does it diverge because
    of a coverage artifact." Declares no winner."""

    results_by_method: Dict[TermMethod, TermStructureResult]

    def slopes(self) -> Dict[TermMethod, Optional[float]]:
        return {method: result.slope for method, result in self.results_by_method.items()}

    def all_strike_diverges_from_matched(self, tolerance: float) -> Optional[bool]:
        """True when ALL_STRIKE_MEAN's slope differs from MATCHED_LOG_
        MONEYNESS's slope by more than `tolerance` -- direct evidence the
        production method's moneyness-mix concern is real for this
        specific observation. None if either method's slope is unknown."""
        all_strike = self.results_by_method.get(TermMethod.ALL_STRIKE_MEAN)
        matched = self.results_by_method.get(TermMethod.MATCHED_LOG_MONEYNESS)
        if all_strike is None or matched is None or all_strike.slope is None or matched.slope is None:
            return None
        return abs(all_strike.slope - matched.slope) > tolerance
