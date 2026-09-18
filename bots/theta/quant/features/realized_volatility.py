"""Realized-volatility baselines (Phase C2 research).

`regime_v0.py`'s `RegimeInputs.rv20` is an externally-supplied `Optional[float]`
-- that module classifies a volatility state from it but has never computed
it. This module fills that specific, previously-unimplemented gap: pure,
dependency-free realized-volatility ESTIMATORS over an already point-in-time
-ordered price series, plus HAR-RV (Corsi 2009) feature construction for a
future entry-outcome/regime challenger (docs/quant/phase2/MODEL_REGISTRY.md).

RESEARCH_ONLY: nothing in this repository wires these functions into a
production decision path yet. No caller may treat any function here as a
forecast of future volatility -- these are DESCRIPTIVE estimators of
ALREADY-REALIZED price variation, nothing more.

MODEL-001 (baseline-first, restated per docs/quant/phase2/MODEL_REGISTRY.md):
a more sophisticated volatility challenger (GARCH/EGARCH/rough-volatility/
LSTM, per the THETA C2 research directive) must beat the simplest baseline
(`close_to_close_realized_volatility`) on untouched OOS before being
preferred -- this module implements the simple baseline FIRST and does not
smuggle in a "better" default. HAR-RV sits between the two: still a linear,
fully transparent model, but conditioning on multiple realized-vol horizons
the way Corsi (2009) originally proposed, before reaching for anything
nonlinear.

Point-in-time safety: every function here only ever reads indices <= the
caller-supplied `as_of_index` (or the whole series, for the plain estimators,
which have no forward/backward distinction to violate) -- it is the CALLER's
responsibility to ensure the underlying `closes`/`highs`/`lows`/`rv_series`
themselves contain no forward-looking bars; this module has no way to
verify that from a bare sequence of floats (docs/quant/phase2/
DATASET_AND_LABEL_CONTRACT.md owns that guarantee upstream).

UNKNOWN != ZERO throughout: every estimator returns `None` (never a
fabricated `0.0`) when it does not have enough valid observations for the
window it claims to compute -- a short/interrupted series is UNKNOWN, not a
quiet zero.
"""

from dataclasses import dataclass
from math import log, sqrt
from typing import List, Optional, Sequence, Tuple


def _finite_positive(value: Optional[float]) -> bool:
    return value is not None and value > 0


def close_to_close_log_returns(closes: Sequence[Optional[float]]) -> List[float]:
    """log(close[t] / close[t-1]) for each consecutive, both-known, both-
    positive pair. A missing or non-positive bar breaks that one pair (it is
    simply not emitted) rather than being coerced into a fabricated return --
    this can shorten the effective sample, which is exactly why every
    estimator below separately enforces its own `min_periods` floor rather
    than trusting `len(closes)` at face value.
    """
    returns: List[float] = []
    for previous, current in zip(closes, closes[1:]):
        if not _finite_positive(previous) or not _finite_positive(current):
            continue
        returns.append(log(current / previous))  # type: ignore[arg-type]
    return returns


def close_to_close_realized_volatility(
    closes: Sequence[Optional[float]], periods_per_year: float = 252.0, min_periods: int = 2,
) -> Optional[float]:
    """The simplest, canonical baseline: annualized sample stdev of
    close-to-close log returns. `min_periods` (default 2, the fewest returns
    from which a sample stdev is even defined) can be raised by the caller
    for a specific window size (e.g. 20 for an "rv20" feature) -- this
    function never silently accepts a shorter window than requested.
    """
    returns = close_to_close_log_returns(closes)
    if len(returns) < max(min_periods, 2):
        return None
    mean = sum(returns) / len(returns)
    variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
    return sqrt(variance) * sqrt(periods_per_year)


def parkinson_realized_volatility(
    highs: Sequence[Optional[float]], lows: Sequence[Optional[float]],
    periods_per_year: float = 252.0, min_periods: int = 2,
) -> Optional[float]:
    """Parkinson (1980) high-low range estimator -- uses intraday range
    information close-to-close ignores, at the cost of assuming no
    overnight gap and no drift. `highs`/`lows` must be the same length and
    pairwise aligned; any bar where either side is missing or `low > high`
    (a broken/crossed bar) is skipped, never coerced.
    """
    if len(highs) != len(lows):
        raise ValueError('REALIZED_VOLATILITY_HIGH_LOW_LENGTH_MISMATCH')
    ln2 = log(2.0)
    squared_log_ranges: List[float] = []
    for high, low in zip(highs, lows):
        if not _finite_positive(high) or not _finite_positive(low) or low > high:  # type: ignore[operator]
            continue
        squared_log_ranges.append(log(high / low) ** 2)  # type: ignore[arg-type]
    if len(squared_log_ranges) < max(min_periods, 1):
        return None
    mean_squared_log_range = sum(squared_log_ranges) / len(squared_log_ranges)
    return sqrt(mean_squared_log_range / (4.0 * ln2)) * sqrt(periods_per_year)


def ewma_variance_series(
    returns: Sequence[float], decay_lambda: float = 0.94, seed_periods: int = 20,
) -> List[Optional[float]]:
    """RiskMetrics-style EWMA variance recursion:
    `var[t] = lambda * var[t-1] + (1 - lambda) * returns[t]^2`.

    The series is seeded with the simple sample variance of the first
    `seed_periods` returns (never a fabricated `0.0` seed) -- every index
    before that seed window is `None` (UNKNOWN), not a silently-wrong early
    EWMA value computed from too few observations.
    """
    if not (0.0 < decay_lambda < 1.0):
        raise ValueError('REALIZED_VOLATILITY_INVALID_DECAY_LAMBDA')
    result: List[Optional[float]] = [None] * len(returns)
    if len(returns) < max(seed_periods, 2):
        return result
    seed_window = returns[:seed_periods]
    seed_mean = sum(seed_window) / len(seed_window)
    seed_variance = sum((value - seed_mean) ** 2 for value in seed_window) / (len(seed_window) - 1)
    result[seed_periods - 1] = seed_variance
    running = seed_variance
    for index in range(seed_periods, len(returns)):
        running = decay_lambda * running + (1.0 - decay_lambda) * (returns[index] ** 2)
        result[index] = running
    return result


def ewma_volatility(
    closes: Sequence[Optional[float]], decay_lambda: float = 0.94,
    seed_periods: int = 20, periods_per_year: float = 252.0,
) -> Optional[float]:
    """The latest annualized EWMA volatility estimate from a close series --
    convenience wrapper over `close_to_close_log_returns` +
    `ewma_variance_series`. `None` whenever the series is too short to seed
    the recursion at all.
    """
    returns = close_to_close_log_returns(closes)
    series = ewma_variance_series(returns, decay_lambda=decay_lambda, seed_periods=seed_periods)
    latest = series[-1] if series else None
    return sqrt(latest * periods_per_year) if latest is not None else None


@dataclass(frozen=True)
class HarRvFeatures:
    """The three HAR-RV (Corsi, 2009) regressors, in REALIZED-VARIANCE space
    (not volatility/stdev space -- HAR-RV is conventionally specified and
    fitted on variance, matching the original paper). `as_of_index` is the
    last index actually consumed (never any index after it), preserved so a
    caller/reviewer can audit that no forward-looking bar leaked in.
    """
    as_of_index: int
    daily: float
    weekly: float
    monthly: float


def har_rv_features(
    realized_variance_series: Sequence[Optional[float]], as_of_index: int,
    weekly_window: int = 5, monthly_window: int = 22,
) -> Optional[HarRvFeatures]:
    """Builds the HAR-RV daily/weekly/monthly regressor triplet as of
    `as_of_index`, using ONLY `realized_variance_series[: as_of_index + 1]`
    -- indices after `as_of_index` are never read, by construction, so this
    function cannot leak a future realized-variance observation into a
    feature regardless of what the caller passes for the rest of the array.

    Returns `None` (never a fabricated feature from a partial window) when
    fewer than `monthly_window` valid (non-`None`) observations exist up to
    and including `as_of_index` -- a "monthly" average computed from, say,
    6 real days is not honestly a monthly feature and must not be labeled
    as one.
    """
    if as_of_index < 0 or as_of_index >= len(realized_variance_series):
        raise ValueError('REALIZED_VOLATILITY_AS_OF_INDEX_OUT_OF_RANGE')
    window = realized_variance_series[: as_of_index + 1]
    monthly_slice = window[-monthly_window:]
    if len(monthly_slice) < monthly_window or any(value is None for value in monthly_slice):
        return None
    weekly_slice = monthly_slice[-weekly_window:]
    daily_value = monthly_slice[-1]
    assert daily_value is not None  # narrowed by the `any(... is None)` check above
    return HarRvFeatures(
        as_of_index=as_of_index,
        daily=float(daily_value),
        weekly=sum(weekly_slice) / len(weekly_slice),  # type: ignore[arg-type]
        monthly=sum(monthly_slice) / len(monthly_slice),  # type: ignore[arg-type]
    )


@dataclass(frozen=True)
class HarRvCoefficients:
    """A fitted HAR-RV linear model: `target ≈ intercept + beta_d*daily +
    beta_w*weekly + beta_m*monthly`. Fitting is ordinary least squares over
    whatever `(features, target)` pairs the caller supplies -- this module
    has no concept of train/validation/OOS split; that discipline belongs
    to `docs/research/THETA_WALK_FORWARD_SPEC.md`, and callers MUST NOT
    pass OOS rows into `fit_har_rv_ols` (this function cannot detect or
    prevent that misuse from its own inputs alone).
    """
    intercept: float
    beta_daily: float
    beta_weekly: float
    beta_monthly: float
    observations: int


def _solve_normal_equations(design_rows: List[Tuple[float, float, float, float]], targets: List[float]) -> Optional[List[float]]:
    """Closed-form OLS via the normal equations (X^T X) beta = X^T y, solved
    by Gauss-Jordan elimination on the resulting small (4x4) system. Returns
    `None` (never a fabricated fit) if the system is singular (e.g. every
    row identical, or fewer independent observations than regressors).
    """
    k = len(design_rows[0])
    xtx = [[0.0] * k for _ in range(k)]
    xty = [0.0] * k
    for row, target in zip(design_rows, targets):
        for i in range(k):
            xty[i] += row[i] * target
            for j in range(k):
                xtx[i][j] += row[i] * row[j]
    augmented = [xtx[i] + [xty[i]] for i in range(k)]
    for pivot in range(k):
        pivot_value = augmented[pivot][pivot]
        if abs(pivot_value) < 1e-12:
            for candidate in range(pivot + 1, k):
                if abs(augmented[candidate][pivot]) >= 1e-12:
                    augmented[pivot], augmented[candidate] = augmented[candidate], augmented[pivot]
                    pivot_value = augmented[pivot][pivot]
                    break
            else:
                return None
        augmented[pivot] = [value / pivot_value for value in augmented[pivot]]
        for row_index in range(k):
            if row_index == pivot:
                continue
            factor = augmented[row_index][pivot]
            if factor == 0.0:
                continue
            augmented[row_index] = [
                augmented[row_index][col] - factor * augmented[pivot][col] for col in range(k + 1)
            ]
    return [augmented[i][k] for i in range(k)]


def fit_har_rv_ols(features: Sequence[HarRvFeatures], targets: Sequence[float]) -> Optional[HarRvCoefficients]:
    """Fits `target ≈ intercept + beta_d*daily + beta_w*weekly +
    beta_m*monthly` by OLS. `features`/`targets` must be the same length and
    already index-aligned by the caller (`targets[i]` is whatever
    realized-variance-at-a-future-horizon label corresponds to
    `features[i]`, per the caller's own label contract -- this module has
    no label semantics of its own). Requires strictly more observations
    than the 4 free parameters; returns `None` on a singular/under-
    determined system rather than a fabricated fit.
    """
    if len(features) != len(targets):
        raise ValueError('REALIZED_VOLATILITY_HAR_RV_FEATURE_TARGET_LENGTH_MISMATCH')
    if len(features) <= 4:
        return None
    design_rows = [(1.0, feature.daily, feature.weekly, feature.monthly) for feature in features]
    solved = _solve_normal_equations(design_rows, list(targets))
    if solved is None:
        return None
    intercept, beta_daily, beta_weekly, beta_monthly = solved
    return HarRvCoefficients(
        intercept=intercept, beta_daily=beta_daily, beta_weekly=beta_weekly, beta_monthly=beta_monthly,
        observations=len(features),
    )
