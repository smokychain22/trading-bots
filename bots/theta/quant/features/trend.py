"""Trend feature (THETA overnight quant build, Phase 2 feature family: TREND).

`regime_v0.py`'s `RegimeInputs.ma_slope` is an externally-supplied
`Optional[float]` -- that module classifies BULL/BEAR/RANGE from it but has
never computed it, exactly the same previously-unimplemented-producer gap
`realized_volatility.py` filled for `rv20`. This module fills it for
`ma_slope`: a pure, dependency-free, point-in-time-safe moving-average-slope
estimator over an already PIT-ordered close series, plus a typed feature
result carrying explicit state (never a bare float that hides insufficiency).

RESEARCH_ONLY: nothing in this repository wires this into a production
decision path yet. `regime_v0.classify_trend` remains the one place a
BULL/BEAR/RANGE label is assigned; this module only produces its numeric
input honestly.

Point-in-time safety: `moving_average_slope` and `TrendFeature.compute` only
ever read `closes[: as_of_index + 1]` -- no index after `as_of_index` is
read, by construction, regardless of what the caller passes for the rest of
the array. It is the CALLER's responsibility that `closes` itself contains
no forward-looking bars (docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md
owns that guarantee upstream) -- this module cannot verify that from a bare
sequence of floats, the same limitation `realized_volatility.py` documents.

UNKNOWN != ZERO: a short/interrupted series produces `state=INSUFFICIENT_HISTORY`
and `slope=None`, never a fabricated `0.0` slope.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence


class TrendFeatureState(str, Enum):
    OK = "OK"
    UNKNOWN = "UNKNOWN"  # a required bar is missing/None inside the window
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"  # fewer bars than the window requires
    STALE = "STALE"  # the most recent bar is older than the freshness policy allows


@dataclass(frozen=True)
class TrendFeature:
    """The one typed TREND feature result. `slope` is the fractional
    per-period change in the moving average (dimensionless, e.g. 0.001 =
    +0.1% per bar) -- directly usable as `RegimeInputs.ma_slope`.
    `as_of_index` is the last index actually consumed, preserved so a
    reviewer can audit that no forward-looking bar leaked in.
    """
    state: TrendFeatureState
    slope: Optional[float]
    as_of_index: int
    window: int
    ma_window: int
    reason_code: str


def _simple_moving_average(values: Sequence[float]) -> float:
    return sum(values) / len(values)


def moving_average_slope(
    closes: Sequence[Optional[float]],
    as_of_index: int,
    ma_window: int = 20,
    slope_window: int = 5,
    max_bars_since_last: int = 1,
) -> TrendFeature:
    """The moving-average-slope TREND feature as of `as_of_index`.

    Computes a trailing `ma_window`-bar simple moving average at
    `as_of_index` and at `as_of_index - slope_window`, then reports the
    fractional change between the two -- a smoothed, less noisy trend
    signal than a raw single-bar return, and deliberately simpler than any
    complex trend model per this repo's baseline-first discipline
    (docs/quant/phase2/MODEL_REGISTRY.md, MODEL-001).

    `max_bars_since_last` is a freshness policy: if `as_of_index` is not
    the LAST index of `closes` by more than this many bars, the feature is
    `STALE` -- the caller passed a series whose most recent observation is
    older than the decision moment allows.
    """
    if as_of_index < 0 or as_of_index >= len(closes):
        raise ValueError("TREND_AS_OF_INDEX_OUT_OF_RANGE")
    if ma_window < 2:
        raise ValueError("TREND_MA_WINDOW_TOO_SMALL")
    if slope_window < 1:
        raise ValueError("TREND_SLOPE_WINDOW_TOO_SMALL")

    bars_since_last = (len(closes) - 1) - as_of_index
    if bars_since_last > max_bars_since_last:
        return TrendFeature(
            state=TrendFeatureState.STALE, slope=None, as_of_index=as_of_index,
            window=slope_window, ma_window=ma_window,
            reason_code=f"TREND_STALE:{bars_since_last}_bars_since_as_of",
        )

    required_span = ma_window + slope_window
    window = closes[: as_of_index + 1]
    if len(window) < required_span:
        return TrendFeature(
            state=TrendFeatureState.INSUFFICIENT_HISTORY, slope=None, as_of_index=as_of_index,
            window=slope_window, ma_window=ma_window,
            reason_code=f"TREND_INSUFFICIENT_HISTORY:{len(window)}_of_{required_span}_required",
        )

    current_window = window[-ma_window:]
    prior_window = window[-(ma_window + slope_window): -slope_window]
    if any(value is None for value in current_window) or any(value is None for value in prior_window):
        return TrendFeature(
            state=TrendFeatureState.UNKNOWN, slope=None, as_of_index=as_of_index,
            window=slope_window, ma_window=ma_window,
            reason_code="TREND_UNKNOWN:missing_bar_in_window",
        )

    current_ma = _simple_moving_average(current_window)  # type: ignore[arg-type]
    prior_ma = _simple_moving_average(prior_window)  # type: ignore[arg-type]
    if prior_ma == 0.0:
        return TrendFeature(
            state=TrendFeatureState.UNKNOWN, slope=None, as_of_index=as_of_index,
            window=slope_window, ma_window=ma_window,
            reason_code="TREND_UNKNOWN:zero_prior_moving_average",
        )
    slope = (current_ma - prior_ma) / prior_ma
    return TrendFeature(
        state=TrendFeatureState.OK, slope=slope, as_of_index=as_of_index,
        window=slope_window, ma_window=ma_window, reason_code="TREND_OK",
    )
