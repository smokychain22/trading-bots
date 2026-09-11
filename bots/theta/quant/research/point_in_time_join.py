"""Deterministic point-in-time joins for THETA replay/research (R6).

Rejects POSITIONAL (list-index) joins between independently-sampled time
series -- the exact finding from this session's GitHub corpus review
(`docs/research/THETA_GITHUB_TOP15.md`'s "reject... positional date
joins" note on optopsy/lambdaclass): a backtester that zips a stock-price
series and an option-quote series by list position silently misaligns
the moment either series has a missing day, a holiday, an early close, a
duplicate timestamp, or a different sampling frequency from the other.

Every join here is keyed by an explicit (as_of date, key, source) tuple,
never row position. A join that cannot find an exact match either fails
closed (MISSING) or, when the caller explicitly opts into an "as-of"
tolerance, looks BACKWARD only (never forward -- a future observation
must never satisfy a past decision's join, per the point-in-time-safety
discipline already frozen in
`docs/quant/phase2/DATASET_AND_LABEL_CONTRACT.md`).

No I/O, no provider dependency -- pure functions over already-fetched
observation lists, exactly like every other model in
`bots/theta/quant/models/`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Dict, Generic, List, Optional, Sequence, Tuple, TypeVar

T = TypeVar("T")


def _parse_date(value: str) -> date:
    """Accepts an ISO date ('2026-09-11') or an ISO datetime
    ('2026-09-11T15:00:00Z') and returns the calendar date component --
    joins in this module are always at daily granularity (the sampling
    frequency THETA's own historical bars/options-chain snapshots use);
    finer-than-daily point-in-time joins are out of scope for this
    module."""
    text = value.replace("Z", "+00:00") if "T" in value else value
    if "T" in text:
        return datetime.fromisoformat(text).date()
    return date.fromisoformat(text)


@dataclass(frozen=True)
class TimestampedObservation(Generic[T]):
    """One dated, sourced, keyed observation. `key` is whatever identity
    the series is keyed by (an option contract symbol, an underlying
    ticker); `source` is the provider name -- kept distinct from `key`
    because the same key can legitimately have observations from two
    different sources (e.g. Alpaca vs. Optionomics) that must never be
    silently merged into one join target without the caller choosing
    which source wins."""

    as_of: str  # ISO date or datetime
    key: str
    source: str
    value: T


class JoinFailureReason(str, Enum):
    MISSING = "MISSING"  # no observation exists for this (key, date) at all
    STALE = "STALE"  # the nearest available observation is older than the caller's tolerance
    DUPLICATE = "DUPLICATE"  # more than one observation exists for the same (key, date, source) with DIFFERENT values -- ambiguous, never silently picks one
    HOLIDAY = "HOLIDAY"  # the requested date is a known non-trading day (caller-supplied calendar) -- distinct from ordinary MISSING


@dataclass(frozen=True)
class JoinResult(Generic[T]):
    as_of: str
    key: str
    value: Optional[T]
    resolved_from_as_of: Optional[str]  # the actual observation date used (may be earlier than `as_of` under an as-of tolerance) -- None when failed
    failure_reason: Optional[JoinFailureReason]


class DuplicateObservationError(ValueError):
    """Raised when building an index and the same (key, date, source)
    appears twice with genuinely different values -- this is never
    silently resolved by picking the first, the last, or an average; the
    caller must fix the upstream data or explicitly choose a resolution
    policy outside this module."""


def build_point_in_time_index(
    observations: Sequence[TimestampedObservation[T]],
) -> Dict[Tuple[str, date, str], TimestampedObservation[T]]:
    """Builds a deterministic (key, date, source) -> observation index.
    Raises DuplicateObservationError if the same (key, date, source)
    appears more than once with different values -- this is a data
    integrity problem, not a join-time decision, and must never be
    silently resolved by list order (the exact positional-join mistake
    this module exists to prevent from recurring one level up)."""
    index: Dict[Tuple[str, date, str], TimestampedObservation[T]] = {}
    for obs in observations:
        obs_date = _parse_date(obs.as_of)
        map_key = (obs.key, obs_date, obs.source)
        existing = index.get(map_key)
        if existing is not None and existing.value != obs.value:
            raise DuplicateObservationError(
                f"conflicting observations for key={obs.key} date={obs_date} source={obs.source}: "
                f"{existing.value!r} vs {obs.value!r}"
            )
        index[map_key] = obs
    return index


def detect_out_of_order(observations: Sequence[TimestampedObservation[T]]) -> List[str]:
    """Returns the list of keys whose own observation series is not
    monotonically non-decreasing in `as_of` -- a genuinely out-of-order
    series (not merely a series with gaps) that must be flagged before
    any join is trusted, since it usually indicates a data-pipeline bug
    (e.g. two differently-sorted upstream batches concatenated without
    re-sorting)."""
    by_key: Dict[str, List[date]] = {}
    for obs in observations:
        by_key.setdefault(obs.key, []).append(_parse_date(obs.as_of))
    out_of_order: List[str] = []
    for key, dates in by_key.items():
        if any(dates[i] > dates[i + 1] for i in range(len(dates) - 1)):
            out_of_order.append(key)
    return out_of_order


def join_as_of(
    key: str,
    as_of: str,
    index: Dict[Tuple[str, date, str], TimestampedObservation[T]],
    source: str,
    trading_calendar: Optional[Sequence[str]] = None,
    max_staleness_days: int = 0,
) -> JoinResult[T]:
    """Looks up the observation for `key` at `source` as of `as_of`.

    - Exact match (max_staleness_days=0, the default): the (key, date,
      source) triple must exist exactly, or the join fails MISSING.
    - `trading_calendar` (an explicit list of ISO trading dates, caller-
      supplied -- never inferred): if given and `as_of` is not in it, the
      join fails HOLIDAY rather than an ordinary MISSING, so a caller can
      distinguish "the market was closed" from "the market was open and
      we simply have no data."
    - `max_staleness_days` > 0: if no exact match exists, searches
      BACKWARD (never forward -- a future observation must never satisfy
      a past join) up to that many calendar days for the most recent
      available observation. If the nearest one found is still outside
      the tolerance (or none exists at all), fails STALE (if any older
      observation exists at all, just outside tolerance) or MISSING (if
      none exists in the whole lookback window).
    """
    as_of_date = _parse_date(as_of)

    if trading_calendar is not None:
        calendar_dates = {_parse_date(d) for d in trading_calendar}
        if as_of_date not in calendar_dates:
            return JoinResult(as_of=as_of, key=key, value=None, resolved_from_as_of=None, failure_reason=JoinFailureReason.HOLIDAY)

    exact = index.get((key, as_of_date, source))
    if exact is not None:
        return JoinResult(as_of=as_of, key=key, value=exact.value, resolved_from_as_of=exact.as_of, failure_reason=None)

    if max_staleness_days <= 0:
        return JoinResult(as_of=as_of, key=key, value=None, resolved_from_as_of=None, failure_reason=JoinFailureReason.MISSING)

    # Backward-only search, day by day, never crossing into the future.
    nearest_within_tolerance: Optional[TimestampedObservation[T]] = None
    nearest_beyond_tolerance: Optional[TimestampedObservation[T]] = None
    for offset in range(1, max_staleness_days + 60):  # search a bounded window past the tolerance, to distinguish STALE from MISSING
        candidate_date = as_of_date - timedelta(days=offset)
        candidate = index.get((key, candidate_date, source))
        if candidate is None:
            continue
        if offset <= max_staleness_days:
            nearest_within_tolerance = candidate
        else:
            nearest_beyond_tolerance = candidate
        break  # first (most recent) match found in this backward scan, whether in or out of tolerance

    if nearest_within_tolerance is not None:
        return JoinResult(
            as_of=as_of, key=key, value=nearest_within_tolerance.value,
            resolved_from_as_of=nearest_within_tolerance.as_of, failure_reason=None,
        )
    if nearest_beyond_tolerance is not None:
        return JoinResult(as_of=as_of, key=key, value=None, resolved_from_as_of=nearest_beyond_tolerance.as_of, failure_reason=JoinFailureReason.STALE)
    return JoinResult(as_of=as_of, key=key, value=None, resolved_from_as_of=None, failure_reason=JoinFailureReason.MISSING)
