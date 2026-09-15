"""Volatility-surface research: raw SVI fit + no-arbitrage diagnostics (R6 item 6).

Dependency-free (no numpy/scipy), matching this package's existing
convention (`bs_reference.py`). Implements the RAW SVI parameterization
(Gatheral 2004) via the well-known "quasi-explicit" calibration: for a
FIXED (m, sigma), total variance is LINEAR in (a, d, c) where
`d = b*rho*sigma`, `c = b*sigma`, so the three linear parameters solve by
ordinary least squares (3x3 normal equations, no library needed) while
(m, sigma) are chosen by a grid search minimizing residual sum of squares.
This is a real, citable calibration method -- not a placeholder.

Every result carries explicit fit-quality and arbitrage-check diagnostics.
`SurfaceResidual` is a FEATURE for later ablation, never a trade command,
and a bad/insufficient fit produces UNKNOWN, never a fabricated precise
number. SSVI/eSSVI remain later challengers per the standing directive --
this module deliberately implements only the simpler raw-SVI baseline
first, per the "earn complexity through OOS economics" discipline.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class SurfacePoint:
    """One PIT-valid market observation: (log-moneyness, total variance).
    Callers compute `k = ln(K/F)` and `w = market_iv**2 * T` themselves
    from PIT-safe strike/forward/IV/DTE inputs -- this module only ever
    sees the already-transformed point, so it cannot itself leak a future
    quote."""

    log_moneyness: float  # k = ln(K/F)
    total_variance: float  # w = IV^2 * T, must be > 0
    liquid: bool  # caller's own quote-quality/liquidity filter decision


class FitQuality(str, Enum):
    GOOD = "GOOD"
    DEGRADED = "DEGRADED"  # fit converged but residual/coverage is marginal
    UNRELIABLE = "UNRELIABLE"  # fit converged but arbitrage checks failed


class ArbitrageStatus(str, Enum):
    NO_VIOLATION_DETECTED = "NO_VIOLATION_DETECTED"
    BUTTERFLY_VIOLATION = "BUTTERFLY_VIOLATION"
    CALENDAR_VIOLATION = "CALENDAR_VIOLATION"
    BOTH_VIOLATIONS = "BOTH_VIOLATIONS"
    NOT_CHECKED = "NOT_CHECKED"  # no fit to check (insufficient data)


@dataclass(frozen=True)
class RawSviParameters:
    """The five raw-SVI parameters (Gatheral 2004): w(k) = a + b*(rho*(k-m)
    + sqrt((k-m)^2 + sigma^2)). `b >= 0` and `|rho| < 1` are structural
    requirements of the parameterization itself, not a business rule."""

    a: float
    b: float
    rho: float
    m: float
    sigma: float


@dataclass(frozen=True)
class SurfaceFitDiagnostics:
    strike_count_total: int
    strike_count_liquid: int
    min_strike_count_required: int
    fit_residual_rms: Optional[float]  # None if no fit was attempted
    butterfly_sufficient_condition_holds: Optional[bool]  # None if not checked
    near_expiry_flag: bool  # True when the caller marks this expiry as very near-dated (fit less trustworthy)


@dataclass(frozen=True)
class SurfaceFitResult:
    expiry: str
    parameters: Optional[RawSviParameters]
    diagnostics: SurfaceFitDiagnostics
    fit_quality: Optional[FitQuality]
    arbitrage_status: ArbitrageStatus
    evidence_state: str  # "FITTED" | "INSUFFICIENT_DATA" | "FIT_DID_NOT_CONVERGE"


def raw_svi_total_variance(log_moneyness: float, params: RawSviParameters) -> float:
    """w(k) = a + b*(rho*(k-m) + sqrt((k-m)**2 + sigma**2))."""
    y = log_moneyness - params.m
    return params.a + params.b * (params.rho * y + math.sqrt(y * y + params.sigma * params.sigma))


def _solve_3x3(matrix: List[List[float]], rhs: List[float]) -> Optional[Tuple[float, float, float]]:
    """Dependency-free 3x3 linear solve via Gaussian elimination with
    partial pivoting. Returns None (never a garbage result) if the system
    is singular within a small numerical tolerance."""
    m = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    n = 3
    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot_row][col]) < 1e-12:
            return None
        m[col], m[pivot_row] = m[pivot_row], m[col]
        for row in range(col + 1, n):
            factor = m[row][col] / m[col][col]
            for c in range(col, n + 1):
                m[row][c] -= factor * m[col][c]
    x = [0.0, 0.0, 0.0]
    for row in range(n - 1, -1, -1):
        total = m[row][n] - sum(m[row][c] * x[c] for c in range(row + 1, n))
        x[row] = total / m[row][row]
    return x[0], x[1], x[2]


def _fit_linear_given_m_sigma(points: Sequence[SurfacePoint], m: float, sigma: float) -> Optional[Tuple[float, float, float, float]]:
    """For fixed (m, sigma), w(k) = a + d*y + c*sqrt(y^2+1) where
    y=(k-m)/sigma, is LINEAR in (a, d, c). Solves the ordinary least-
    squares normal equations for (a, d, c) and returns (a, d, c, rss)."""
    if sigma <= 0:
        return None
    rows: List[Tuple[float, float, float, float]] = []  # (y, z, 1, w) design rows use (1, y, z)
    for point in points:
        y = (point.log_moneyness - m) / sigma
        z = math.sqrt(y * y + 1.0)
        rows.append((1.0, y, z, point.total_variance))
    # Normal equations: (X^T X) beta = X^T w, beta = (a, d, c)
    xtx = [[0.0] * 3 for _ in range(3)]
    xtw = [0.0, 0.0, 0.0]
    for one, y, z, w in rows:
        features = (one, y, z)
        for i in range(3):
            xtw[i] += features[i] * w
            for j in range(3):
                xtx[i][j] += features[i] * features[j]
    solved = _solve_3x3(xtx, xtw)
    if solved is None:
        return None
    a, d, c = solved
    rss = sum((a + d * y + c * z - w) ** 2 for _, y, z, w in rows)
    return a, d, c, rss


def check_butterfly_arbitrage_sufficient(b: float, rho: float, sigma: float) -> bool:
    """Gatheral's (2004) SUFFICIENT (not necessary) condition for a raw
    SVI slice to be free of butterfly arbitrage: `b*sigma*(1+|rho|) <= 4`.
    A False result means the condition could not confirm arbitrage-
    freedom -- it does NOT prove a violation exists, since the condition
    is only sufficient. Labeled explicitly to avoid overclaiming
    precision this simple check does not have."""
    return b * sigma * (1.0 + abs(rho)) <= 4.0


def check_calendar_arbitrage(
    near: RawSviParameters, far: RawSviParameters, k_samples: Sequence[float],
) -> bool:
    """Total variance must be non-decreasing in T at matched log-moneyness
    (Gatheral & Jacquier 2013). Checks a caller-supplied set of sample
    k-values (never invented internally) and returns True only if the far
    slice's total variance is >= the near slice's at EVERY sampled k."""
    for k in k_samples:
        if raw_svi_total_variance(k, far) < raw_svi_total_variance(k, near) - 1e-10:
            return False
    return True


def fit_raw_svi(
    expiry: str,
    points: Sequence[SurfacePoint],
    min_strike_count: int,
    m_grid: Sequence[float],
    sigma_grid: Sequence[float],
    near_expiry_flag: bool = False,
) -> SurfaceFitResult:
    """Fits raw SVI to the LIQUID subset of `points` via quasi-explicit
    calibration: grid-searches (m, sigma), solving the linear (a, d, c)
    sub-problem exactly at each grid point, and keeps the grid point with
    the lowest residual sum of squares. `min_strike_count`, `m_grid`, and
    `sigma_grid` are all REQUIRED, caller-supplied -- no invented default
    grid or minimum, per the standing no-invented-threshold discipline.

    Returns `evidence_state="INSUFFICIENT_DATA"` (parameters=None) below
    `min_strike_count` liquid points -- never a fit forced through too few
    observations. Returns `"FIT_DID_NOT_CONVERGE"` if every grid point was
    numerically singular."""
    liquid_points = [p for p in points if p.liquid]
    base_diagnostics = SurfaceFitDiagnostics(
        strike_count_total=len(points), strike_count_liquid=len(liquid_points),
        min_strike_count_required=min_strike_count, fit_residual_rms=None,
        butterfly_sufficient_condition_holds=None, near_expiry_flag=near_expiry_flag,
    )
    if len(liquid_points) < min_strike_count:
        return SurfaceFitResult(
            expiry=expiry, parameters=None, diagnostics=base_diagnostics,
            fit_quality=None, arbitrage_status=ArbitrageStatus.NOT_CHECKED,
            evidence_state="INSUFFICIENT_DATA",
        )

    best: Optional[Tuple[float, float, float, float, float, float]] = None  # (rss, a, d, c, m, sigma)
    for m in m_grid:
        for sigma in sigma_grid:
            fitted = _fit_linear_given_m_sigma(liquid_points, m, sigma)
            if fitted is None:
                continue
            a, d, c, rss = fitted
            if best is None or rss < best[0]:
                best = (rss, a, d, c, m, sigma)

    if best is None:
        return SurfaceFitResult(
            expiry=expiry, parameters=None, diagnostics=base_diagnostics,
            fit_quality=None, arbitrage_status=ArbitrageStatus.NOT_CHECKED,
            evidence_state="FIT_DID_NOT_CONVERGE",
        )

    rss, a, d, c, m, sigma = best
    # Recover (b, rho) from (d, c): d = b*rho*sigma, c = b*sigma -> b = c/sigma, rho = d/c
    if sigma <= 0 or c == 0:
        return SurfaceFitResult(
            expiry=expiry, parameters=None, diagnostics=base_diagnostics,
            fit_quality=None, arbitrage_status=ArbitrageStatus.NOT_CHECKED,
            evidence_state="FIT_DID_NOT_CONVERGE",
        )
    b = c / sigma
    rho = d / c
    if b < 0 or not (-1.0 < rho < 1.0):
        # A fit that violates raw SVI's own structural constraints (b>=0,
        # |rho|<1) is not a valid parameterization at all -- never returned
        # as if it were a usable fit.
        return SurfaceFitResult(
            expiry=expiry, parameters=None, diagnostics=base_diagnostics,
            fit_quality=None, arbitrage_status=ArbitrageStatus.NOT_CHECKED,
            evidence_state="FIT_DID_NOT_CONVERGE",
        )

    params = RawSviParameters(a=a, b=b, rho=rho, m=m, sigma=sigma)
    rms = math.sqrt(rss / len(liquid_points))
    butterfly_ok = check_butterfly_arbitrage_sufficient(b, rho, sigma)
    diagnostics = SurfaceFitDiagnostics(
        strike_count_total=len(points), strike_count_liquid=len(liquid_points),
        min_strike_count_required=min_strike_count, fit_residual_rms=rms,
        butterfly_sufficient_condition_holds=butterfly_ok, near_expiry_flag=near_expiry_flag,
    )
    quality = (
        FitQuality.UNRELIABLE if not butterfly_ok
        else FitQuality.DEGRADED if near_expiry_flag or len(liquid_points) < min_strike_count * 2
        else FitQuality.GOOD
    )
    arbitrage_status = ArbitrageStatus.NO_VIOLATION_DETECTED if butterfly_ok else ArbitrageStatus.BUTTERFLY_VIOLATION
    return SurfaceFitResult(
        expiry=expiry, parameters=params, diagnostics=diagnostics,
        fit_quality=quality, arbitrage_status=arbitrage_status, evidence_state="FITTED",
    )


def compute_surface_residual(market_iv: Optional[float], fit: SurfaceFitResult, log_moneyness: float, years_to_expiry: float) -> Optional[float]:
    """SurfaceResidual = MarketIV - FittedIV, at one observed point.
    Returns None -- never a fabricated precise number -- whenever the
    market IV is unknown, the fit did not converge, or the fit's own
    quality is UNRELIABLE (failed the butterfly-arbitrage sufficient
    check). A DEGRADED fit still produces a residual, but the caller must
    treat it accordingly -- this function does not hide that distinction,
    it only refuses UNRELIABLE."""
    if market_iv is None or fit.parameters is None or fit.fit_quality == FitQuality.UNRELIABLE:
        return None
    if years_to_expiry <= 0:
        return None
    fitted_total_variance = raw_svi_total_variance(log_moneyness, fit.parameters)
    if fitted_total_variance < 0:
        return None
    fitted_iv = math.sqrt(fitted_total_variance / years_to_expiry)
    return market_iv - fitted_iv


# ---------------------------------------------------------------------------
# Surface-quality gating (P2C pass 2, directive section 9): closes the
# remaining "how should a strategy react to surface quality" gap left open
# in `docs/research/THETA_FLOW_GEX_VOLATILITY_DECISION_RESEARCH.md`'s
# receipt. Maps an already-computed `SurfaceFitResult` onto one of four
# named states with an explicit reaction posture -- never collapses a bad
# surface into a fabricated zero-skew reading, per the directive's own
# instruction.
# ---------------------------------------------------------------------------


class SurfaceQualityState(str, Enum):
    GOOD = "GOOD"
    THIN = "THIN"  # fit converged but is DEGRADED (marginal coverage or near-expiry) -- usable with caution, never treated as GOOD
    ARBITRAGE_INCONSISTENT = "ARBITRAGE_INCONSISTENT"
    UNKNOWN = "UNKNOWN"  # no fit at all (insufficient data or non-convergence) -- distinct from THIN, which at least produced parameters


class SurfaceQualityReaction(str, Enum):
    """A posture, never a trade command -- matches this module's own
    standing "context feature, not trade authority" discipline."""

    FULL_CONFIDENCE_FEATURE_USE = "FULL_CONFIDENCE_FEATURE_USE"
    REDUCED_CONFIDENCE_WIDEN_UNCERTAINTY = "REDUCED_CONFIDENCE_WIDEN_UNCERTAINTY"
    DO_NOT_USE_SURFACE_FEATURES_THIS_CYCLE = "DO_NOT_USE_SURFACE_FEATURES_THIS_CYCLE"


@dataclass(frozen=True)
class SurfaceQualityAssessment:
    state: SurfaceQualityState
    reaction: SurfaceQualityReaction
    reason: str


def classify_surface_quality_state(fit: SurfaceFitResult) -> SurfaceQualityAssessment:
    """Never returns a skew/term reading of zero for a bad surface -- the
    caller-facing contract is: check `state` first, and only consult
    `fit.parameters` at all when `reaction` is not
    `DO_NOT_USE_SURFACE_FEATURES_THIS_CYCLE`."""
    if fit.parameters is None:
        return SurfaceQualityAssessment(
            SurfaceQualityState.UNKNOWN, SurfaceQualityReaction.DO_NOT_USE_SURFACE_FEATURES_THIS_CYCLE,
            f"NO_FIT_AVAILABLE_{fit.evidence_state}",
        )
    if fit.fit_quality == FitQuality.UNRELIABLE or fit.arbitrage_status in (
        ArbitrageStatus.BUTTERFLY_VIOLATION, ArbitrageStatus.CALENDAR_VIOLATION, ArbitrageStatus.BOTH_VIOLATIONS,
    ):
        return SurfaceQualityAssessment(
            SurfaceQualityState.ARBITRAGE_INCONSISTENT, SurfaceQualityReaction.DO_NOT_USE_SURFACE_FEATURES_THIS_CYCLE,
            f"ARBITRAGE_STATUS_{fit.arbitrage_status.value}",
        )
    if fit.fit_quality == FitQuality.DEGRADED:
        return SurfaceQualityAssessment(
            SurfaceQualityState.THIN, SurfaceQualityReaction.REDUCED_CONFIDENCE_WIDEN_UNCERTAINTY,
            "FIT_CONVERGED_BUT_DEGRADED_COVERAGE_OR_NEAR_EXPIRY",
        )
    return SurfaceQualityAssessment(
        SurfaceQualityState.GOOD, SurfaceQualityReaction.FULL_CONFIDENCE_FEATURE_USE, "FIT_CONVERGED_GOOD_QUALITY",
    )
