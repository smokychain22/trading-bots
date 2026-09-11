"""Drawdown measurement metrics for THETA's Full-H economics (R6B).

These are BACKWARD-LOOKING measurement metrics over an already-realized
equity curve (max drawdown, drawdown duration, time underwater, recovery
time, Ulcer Index) -- distinct from a forward-looking, stateful,
real-time risk-tier manager (the pattern found in
`HasibVortex369/riskkit`'s `DrawdownManager`, reviewed this session:
high-water-mark tracking + tiered size reduction + a "recovery ramp" that
never snaps back to full size instantly -- a genuinely useful pattern,
cataloged as `ADAPT` for a FUTURE AEGIS-integrated real-time risk
manager, but NOT built here, since that is a Production/AEGIS-integration
decision belonging to a later validated handoff, not a research
measurement module).

No I/O, no provider dependency, no real data -- exercised only against
synthetic equity-curve fixtures until real resolved episodes exist
(`docs/research/THETA_EV_MODEL_SPEC.md`'s EV_MODEL_NOT_EMPIRICALLY_READY
status, unchanged).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Sequence


@dataclass(frozen=True)
class EquityPoint:
    as_of: str  # ISO date/datetime -- ordering key, never a list-position assumption
    equity: float


@dataclass(frozen=True)
class DrawdownSummary:
    n: int
    max_drawdown_pct: Optional[float]  # positive number = a real peak-to-trough loss, e.g. 0.12 = 12%
    max_drawdown_duration_days: Optional[float]  # days from the peak to the trough of the worst drawdown
    time_underwater_pct: Optional[float]  # fraction of the whole series spent below any prior peak
    longest_recovery_days: Optional[float]  # the longest time from ANY trough back to a new equity high, among fully-recovered troughs
    unrecovered_trough_present: bool  # True if the series ends still below its own peak -- the current drawdown may not be over
    ulcer_index: Optional[float]  # sqrt(mean(drawdown_pct^2)) across the whole series -- penalizes both depth and duration, unlike max DD alone


def _parse_date_ordinal(value: str) -> float:
    """Accepts an ISO date or datetime and returns a sortable ordinal
    (days since epoch, fractional for sub-day precision) -- never a list
    position. Reuses the same ISO-parsing convention as
    point_in_time_join.py for consistency across this research package."""
    from datetime import datetime

    text = value.replace("Z", "+00:00") if "T" in value else value
    if "T" in text:
        dt = datetime.fromisoformat(text)
    else:
        dt = datetime.fromisoformat(text + "T00:00:00")
    return dt.timestamp() / 86400.0


def compute_drawdown_summary(equity_curve: Sequence[EquityPoint]) -> DrawdownSummary:
    """Computes the full drawdown summary over an already-time-ordered
    (by `as_of`, never assumed pre-sorted -- this function sorts
    explicitly) equity curve. Returns None for every metric (never a
    fabricated 0) when there are fewer than 2 points -- a single point
    has no drawdown concept at all."""
    if len(equity_curve) < 2:
        return DrawdownSummary(
            n=len(equity_curve), max_drawdown_pct=None, max_drawdown_duration_days=None,
            time_underwater_pct=None, longest_recovery_days=None,
            unrecovered_trough_present=False, ulcer_index=None,
        )

    sorted_points = sorted(equity_curve, key=lambda p: _parse_date_ordinal(p.as_of))
    ordinals = [_parse_date_ordinal(p.as_of) for p in sorted_points]
    equities = [p.equity for p in sorted_points]

    peak = equities[0]
    peak_ordinal = ordinals[0]
    max_dd = 0.0
    max_dd_duration = 0.0
    dd_squares: List[float] = []
    underwater_days = 0.0

    # Track troughs and their recoveries: a trough is a local minimum
    # relative to the running peak; it "recovers" the moment equity makes
    # a NEW all-time high after it.
    trough_ordinal: Optional[float] = None
    trough_equity: Optional[float] = None
    recovery_durations: List[float] = []
    unrecovered_trough_present = False

    for i in range(1, len(equities)):
        if equities[i] > peak:
            # A new high: if there was an active trough below the OLD
            # peak, it has now recovered.
            if trough_ordinal is not None:
                recovery_durations.append(ordinals[i] - trough_ordinal)
                trough_ordinal = None
                trough_equity = None
            peak = equities[i]
            peak_ordinal = ordinals[i]
        else:
            dd_pct = (peak - equities[i]) / peak if peak > 0 else 0.0
            dd_squares.append(dd_pct * dd_pct)
            if i > 0:
                underwater_days += ordinals[i] - ordinals[i - 1]
            if dd_pct > max_dd:
                max_dd = dd_pct
                max_dd_duration = ordinals[i] - peak_ordinal
            if trough_equity is None or equities[i] < trough_equity:
                trough_ordinal = ordinals[i]
                trough_equity = equities[i]

    unrecovered_trough_present = trough_ordinal is not None
    total_days = ordinals[-1] - ordinals[0]
    time_underwater_pct = (underwater_days / total_days) if total_days > 0 else None
    longest_recovery = max(recovery_durations) if recovery_durations else None
    ulcer_index = math.sqrt(sum(dd_squares) / len(equities)) if dd_squares else 0.0

    return DrawdownSummary(
        n=len(equity_curve),
        max_drawdown_pct=max_dd,
        max_drawdown_duration_days=max_dd_duration if max_dd > 0 else 0.0,
        time_underwater_pct=time_underwater_pct,
        longest_recovery_days=longest_recovery,
        unrecovered_trough_present=unrecovered_trough_present,
        ulcer_index=ulcer_index,
    )
