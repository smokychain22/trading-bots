"""Temporal features over Optionomics' AGGREGATE net-flow series --
FLOW_ACCELERATION, FLOW_DECELERATION, FLOW_REVERSAL, FLOW_PERSISTENCE.

Deliberately scoped to the aggregate/window-level series
(`/flow/net`-style current net-calls/net-puts buckets), which is the ONE
Optionomics flow surface confirmed populated in real authenticated runs
(per this branch's prior-session capability-census review) -- NOT per-print
flow (sweep/block/aggressor), whose payload schema remains undocumented and
is handled separately by `optionomics_flow_event.py`/
`optionomics_flow_chain_fusion.py` (built ahead of any observed payload).

Mirrors `optionomics-temporal-features.ts`'s own discipline exactly (that
module was independently verified COMPLETE two sessions ago): same-
underlying check, strict causal ordering, a caller-supplied bounded
observation gap (no hardcoded threshold), and UNKNOWN/INVALID propagation
that never coerces a missing or malformed observation into a computed
delta. This module is the Python-side counterpart for the AGGREGATE flow
family specifically, not a duplicate of that TypeScript module's scalar
metric/skew/term/exposure families.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence


class FlowTemporalState(str, Enum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"


@dataclass(frozen=True)
class FlowWindowObservation:
    """One aggregate net-flow observation -- e.g. Optionomics' own current
    net-calls/net-puts bucket for one underlying. `netPremium` is the
    caller-supplied signed net premium for the window (calls-buy-side minus
    puts-buy-side, or whatever the provider's own documented convention is
    -- this module does not invent a sign convention, it only computes
    deltas over whatever the caller supplies)."""

    underlying: str
    observed_at: str  # ISO-8601 UTC
    net_premium: Optional[float]
    window_label: str  # e.g. "CURRENT_5MIN" -- caller-supplied, never inferred


@dataclass(frozen=True)
class FlowTemporalFeature:
    metric_key: str  # "NET_PREMIUM_CHANGE" | "NET_PREMIUM_RATE_PER_HOUR" | "PERSISTENCE_SIGN_MATCH"
    state: FlowTemporalState
    earlier_value: Optional[float]
    current_value: Optional[float]
    absolute_change: Optional[float]
    rate_per_hour: Optional[float]
    elapsed_seconds: Optional[float]
    reason_code: Optional[str]


def _parse_iso_seconds(timestamp: str) -> Optional[float]:
    from datetime import datetime, timezone

    for candidate in (timestamp, timestamp.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return None


def derive_flow_delta(
    earlier: FlowWindowObservation,
    current: FlowWindowObservation,
    maximum_gap_seconds: float,
) -> FlowTemporalFeature:
    """NET_PREMIUM_CHANGE / NET_PREMIUM_RATE_PER_HOUR between two same-
    underlying, same-window-label observations. `maximum_gap_seconds` is a
    required, caller-justified bound -- this module never hardcodes one, per
    the standing no-arbitrary-threshold rule."""
    if earlier.underlying != current.underlying:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.INVALID, None, None, None, None, None, "UNDERLYING_MISMATCH")
    if earlier.window_label != current.window_label:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.UNKNOWN, None, None, None, None, None, "WINDOW_LABEL_MISMATCH")
    earlier_ts = _parse_iso_seconds(earlier.observed_at)
    current_ts = _parse_iso_seconds(current.observed_at)
    if earlier_ts is None or current_ts is None:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.INVALID, None, None, None, None, None, "OBSERVATION_TIMESTAMP_INVALID")
    if current_ts <= earlier_ts:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.INVALID, None, None, None, None, None, "OBSERVATIONS_NOT_STRICTLY_TIME_ORDERED")
    if not (maximum_gap_seconds > 0):
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.INVALID, None, None, None, None, None, "MAXIMUM_GAP_INVALID")
    elapsed = current_ts - earlier_ts
    if elapsed > maximum_gap_seconds:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.UNKNOWN, None, None, None, elapsed, None, "OBSERVATION_GAP_EXCEEDS_POLICY")
    if earlier.net_premium is None or current.net_premium is None:
        return FlowTemporalFeature("NET_PREMIUM_CHANGE", FlowTemporalState.UNKNOWN, earlier.net_premium, current.net_premium, None, None, elapsed, "NET_PREMIUM_UNKNOWN")
    change = current.net_premium - earlier.net_premium
    return FlowTemporalFeature(
        "NET_PREMIUM_CHANGE", FlowTemporalState.KNOWN, earlier.net_premium, current.net_premium,
        change, change * 3600 / elapsed, elapsed, None,
    )


class FlowDirection(str, Enum):
    ACCELERATING = "ACCELERATING"  # same sign as prior period, magnitude increasing
    DECELERATING = "DECELERATING"  # same sign as prior period, magnitude decreasing
    REVERSING = "REVERSING"  # sign flipped between the two periods
    PERSISTENT = "PERSISTENT"  # same sign, roughly stable magnitude (within a caller tolerance)
    UNKNOWN = "UNKNOWN"


def classify_flow_direction(
    observations: Sequence[FlowWindowObservation],
    maximum_gap_seconds: float,
    persistence_tolerance: float,
) -> FlowDirection:
    """Classifies THREE consecutive same-underlying, same-window-label
    observations into acceleration/deceleration/reversal/persistence.
    Requires exactly three observations because a direction judgment needs
    two deltas (earlier->middle, middle->current) -- two observations alone
    give a single delta, which is a rate, not yet a directional trend.
    `persistence_tolerance` is a required, caller-justified relative-change
    bound distinguishing "persistent" from "accelerating"/"decelerating";
    this module hardcodes no default.
    """
    if len(observations) != 3:
        return FlowDirection.UNKNOWN
    first, second, third = observations
    delta_one = derive_flow_delta(first, second, maximum_gap_seconds)
    delta_two = derive_flow_delta(second, third, maximum_gap_seconds)
    if delta_one.state != FlowTemporalState.KNOWN or delta_two.state != FlowTemporalState.KNOWN:
        return FlowDirection.UNKNOWN
    change_one = delta_one.absolute_change
    change_two = delta_two.absolute_change
    if change_one is None or change_two is None:
        return FlowDirection.UNKNOWN
    if not (persistence_tolerance >= 0):
        return FlowDirection.UNKNOWN
    sign_one = 1 if change_one > 0 else (-1 if change_one < 0 else 0)
    sign_two = 1 if change_two > 0 else (-1 if change_two < 0 else 0)
    if sign_one == 0 or sign_two == 0:
        return FlowDirection.UNKNOWN  # a flat period gives no direction to compare against
    if sign_one != sign_two:
        return FlowDirection.REVERSING
    magnitude_change = abs(change_two) - abs(change_one)
    relative_magnitude_change = magnitude_change / abs(change_one) if change_one != 0 else None
    if relative_magnitude_change is None:
        return FlowDirection.UNKNOWN
    if abs(relative_magnitude_change) <= persistence_tolerance:
        return FlowDirection.PERSISTENT
    return FlowDirection.ACCELERATING if relative_magnitude_change > 0 else FlowDirection.DECELERATING
