"""Momentum feature (THETA overnight quant build, Phase 2 feature family:
MOMENTUM).

Deliberately separate from TREND (`trend.py`): TREND is a smoothed
moving-average-slope signal; MOMENTUM here is a raw, unsmoothed
close-to-close return over an explicit horizon -- a different, complementary
signal family, not a renamed duplicate. No production decision path
consumes this yet (RESEARCH_ONLY), matching every other feature module in
this directory.

Point-in-time safety: `horizon_return` only ever reads
`closes[as_of_index - horizon : as_of_index + 1]` -- no index after
`as_of_index` is read, by construction. It is the CALLER's responsibility
that `closes` itself contains no forward-looking bars (same limitation
documented in `realized_volatility.py`/`trend.py`).

Corporate-action semantics: this module assumes `closes` are ALREADY
split/dividend-adjusted by the caller (this repo's existing bar-provider
convention) -- it does not itself detect or adjust for corporate actions,
and never silently produces a distorted return from an unadjusted series;
that adjustment guarantee is upstream, exactly as `realized_volatility.py`
delegates its own no-forward-looking-bar guarantee upstream.

UNKNOWN != ZERO: a missing bar or too-short series produces `state !=
OK` and `return_value=None`, never a fabricated `0.0` return.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence


class MomentumFeatureState(str, Enum):
    OK = "OK"
    UNKNOWN = "UNKNOWN"  # the anchor or current bar is missing/None
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"  # fewer bars than the horizon requires
    STALE = "STALE"  # the most recent bar is older than the freshness policy allows


@dataclass(frozen=True)
class MomentumFeature:
    """The one typed MOMENTUM feature result for one horizon. `return_value`
    is the simple (not log) fractional return over `horizon` bars ending at
    `as_of_index` -- `close[as_of_index] / close[as_of_index - horizon] - 1`.
    `as_of_index` is the last index actually consumed.
    """
    state: MomentumFeatureState
    return_value: Optional[float]
    as_of_index: int
    horizon: int
    reason_code: str


def horizon_return(
    closes: Sequence[Optional[float]],
    as_of_index: int,
    horizon: int,
    max_bars_since_last: int = 1,
) -> MomentumFeature:
    """The `horizon`-bar simple return as of `as_of_index`. `horizon` is the
    number of bars to look back (e.g. `horizon=5` for a "5-bar momentum"
    feature) -- multiple horizons are built by calling this once per
    horizon, never by one function silently returning a bundle of
    unrequested horizons.
    """
    if as_of_index < 0 or as_of_index >= len(closes):
        raise ValueError("MOMENTUM_AS_OF_INDEX_OUT_OF_RANGE")
    if horizon < 1:
        raise ValueError("MOMENTUM_HORIZON_TOO_SMALL")

    bars_since_last = (len(closes) - 1) - as_of_index
    if bars_since_last > max_bars_since_last:
        return MomentumFeature(
            state=MomentumFeatureState.STALE, return_value=None, as_of_index=as_of_index,
            horizon=horizon, reason_code=f"MOMENTUM_STALE:{bars_since_last}_bars_since_as_of",
        )

    anchor_index = as_of_index - horizon
    if anchor_index < 0:
        return MomentumFeature(
            state=MomentumFeatureState.INSUFFICIENT_HISTORY, return_value=None, as_of_index=as_of_index,
            horizon=horizon, reason_code=f"MOMENTUM_INSUFFICIENT_HISTORY:{as_of_index + 1}_of_{horizon + 1}_required",
        )

    anchor_close = closes[anchor_index]
    current_close = closes[as_of_index]
    if anchor_close is None or current_close is None:
        return MomentumFeature(
            state=MomentumFeatureState.UNKNOWN, return_value=None, as_of_index=as_of_index,
            horizon=horizon, reason_code="MOMENTUM_UNKNOWN:missing_anchor_or_current_bar",
        )
    if anchor_close == 0.0:
        return MomentumFeature(
            state=MomentumFeatureState.UNKNOWN, return_value=None, as_of_index=as_of_index,
            horizon=horizon, reason_code="MOMENTUM_UNKNOWN:zero_anchor_close",
        )
    return MomentumFeature(
        state=MomentumFeatureState.OK, return_value=(current_close / anchor_close) - 1.0,
        as_of_index=as_of_index, horizon=horizon, reason_code="MOMENTUM_OK",
    )
