"""EVENT_STATE_CHANGE research (P2C pass 2, directive section 2-4): a formal,
PIT-safe state machine for earnings/corporate/ex-dividend event proximity,
plus the temporal features it feeds. Closes the gap explicitly left open in
`docs/research/THETA_FLOW_GEX_VOLATILITY_DECISION_RESEARCH.md`'s receipt
(`EVENT_STATE_RESEARCH = GAPS`).

Every state transition is derived ONLY from caller-supplied timestamps
(decision time, event time, expiration time) -- this module never infers an
event from volatility/IV/skew behavior, per the directive's explicit
instruction. A missing event timestamp produces `EVENT_DATA_UNKNOWN`, never
a guessed "no event" state -- "we don't know" and "we know there is none"
are kept structurally distinct throughout.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class EventState(str, Enum):
    NO_KNOWN_EVENT = "NO_KNOWN_EVENT"  # caller has affirmatively confirmed no event is scheduled, not merely absent from a feed
    EVENT_APPROACHING = "EVENT_APPROACHING"
    EVENT_INSIDE_CONTRACT_LIFE = "EVENT_INSIDE_CONTRACT_LIFE"  # event falls strictly between decision time and expiration
    EVENT_IMMINENT = "EVENT_IMMINENT"  # inside a caller-supplied imminence window
    EVENT_OCCURRED = "EVENT_OCCURRED"
    POST_EVENT_NORMALIZATION = "POST_EVENT_NORMALIZATION"  # occurred, within a caller-supplied normalization window
    EVENT_DATA_UNKNOWN = "EVENT_DATA_UNKNOWN"


class EventKind(str, Enum):
    EARNINGS = "EARNINGS"
    SCHEDULED_CORPORATE_EVENT = "SCHEDULED_CORPORATE_EVENT"
    MACRO_EVENT = "MACRO_EVENT"  # only where legitimately linked/configured to the underlying, never inferred
    EX_DIVIDEND = "EX_DIVIDEND"


class EventUnknownReason(str, Enum):
    NO_EVENT_SOURCE_CONFIGURED = "NO_EVENT_SOURCE_CONFIGURED"
    EVENT_SOURCE_STALE = "EVENT_SOURCE_STALE"
    EVENT_TIMESTAMP_MISSING = "EVENT_TIMESTAMP_MISSING"
    EVENT_TIMESTAMP_UNPARSEABLE = "EVENT_TIMESTAMP_UNPARSEABLE"
    DECISION_OR_EXPIRATION_TIMESTAMP_MISSING = "DECISION_OR_EXPIRATION_TIMESTAMP_MISSING"


@dataclass(frozen=True)
class EventRecord:
    """A single caller-supplied, already-resolved event fact. `confirmed_no_event`
    distinguishes "checked the source and there is genuinely nothing scheduled"
    from simply not having looked -- callers must set it explicitly True to reach
    `NO_KNOWN_EVENT` rather than `EVENT_DATA_UNKNOWN`."""

    kind: Optional[EventKind]
    event_timestamp: Optional[str]  # ISO-8601, UTC
    source: Optional[str]  # provenance -- e.g. "optionomics_calendar", "alpaca_corporate_actions"
    freshness_seconds: Optional[float]  # age of the source snapshot at decision time
    max_freshness_seconds: Optional[float]  # caller-justified staleness bound; None means "not checked"
    confirmed_no_event: bool = False


@dataclass(frozen=True)
class EventStateResult:
    state: EventState
    event_kind: Optional[EventKind]
    event_timestamp: Optional[str]
    decision_timestamp: Optional[str]
    expiration_timestamp: Optional[str]
    distance_to_event_seconds: Optional[float]
    expiry_crosses_event: Optional[bool]
    source: Optional[str]
    freshness_seconds: Optional[float]
    unknown_reason: Optional[EventUnknownReason]


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def classify_event_state(
    event: EventRecord,
    decision_timestamp: str,
    expiration_timestamp: str,
    imminent_window_seconds: float,
    normalization_window_seconds: float,
) -> EventStateResult:
    """The single state-machine entry point. `imminent_window_seconds` and
    `normalization_window_seconds` are REQUIRED, caller-justified parameters
    -- this module never hardcodes "earnings is imminent inside 3 days" or
    any similar figure. Never infers a state from IV/skew/flow -- only from
    the supplied timestamps and `confirmed_no_event`."""
    decision_dt = _parse(decision_timestamp)
    expiration_dt = _parse(expiration_timestamp)
    if decision_dt is None or expiration_dt is None:
        return EventStateResult(
            EventState.EVENT_DATA_UNKNOWN, event.kind, event.event_timestamp,
            decision_timestamp, expiration_timestamp, None, None, event.source,
            event.freshness_seconds, EventUnknownReason.DECISION_OR_EXPIRATION_TIMESTAMP_MISSING,
        )

    if event.max_freshness_seconds is not None and (
        event.freshness_seconds is None or event.freshness_seconds > event.max_freshness_seconds
    ):
        return EventStateResult(
            EventState.EVENT_DATA_UNKNOWN, event.kind, event.event_timestamp,
            decision_timestamp, expiration_timestamp, None, None, event.source,
            event.freshness_seconds, EventUnknownReason.EVENT_SOURCE_STALE,
        )

    if event.event_timestamp is None:
        if event.confirmed_no_event:
            return EventStateResult(
                EventState.NO_KNOWN_EVENT, event.kind, None, decision_timestamp,
                expiration_timestamp, None, False, event.source, event.freshness_seconds, None,
            )
        reason = (
            EventUnknownReason.NO_EVENT_SOURCE_CONFIGURED if event.source is None
            else EventUnknownReason.EVENT_TIMESTAMP_MISSING
        )
        return EventStateResult(
            EventState.EVENT_DATA_UNKNOWN, event.kind, None, decision_timestamp,
            expiration_timestamp, None, None, event.source, event.freshness_seconds, reason,
        )

    event_dt = _parse(event.event_timestamp)
    if event_dt is None:
        return EventStateResult(
            EventState.EVENT_DATA_UNKNOWN, event.kind, event.event_timestamp,
            decision_timestamp, expiration_timestamp, None, None, event.source,
            event.freshness_seconds, EventUnknownReason.EVENT_TIMESTAMP_UNPARSEABLE,
        )

    distance_seconds = (event_dt - decision_dt).total_seconds()
    crosses = decision_dt < event_dt < expiration_dt

    if event_dt <= decision_dt:
        age = (decision_dt - event_dt).total_seconds()
        state = (
            EventState.POST_EVENT_NORMALIZATION if age <= normalization_window_seconds
            else EventState.EVENT_OCCURRED
        )
    elif distance_seconds <= imminent_window_seconds:
        state = EventState.EVENT_IMMINENT
    elif crosses:
        state = EventState.EVENT_INSIDE_CONTRACT_LIFE
    else:
        state = EventState.EVENT_APPROACHING

    return EventStateResult(
        state, event.kind, event.event_timestamp, decision_timestamp, expiration_timestamp,
        distance_seconds, crosses, event.source, event.freshness_seconds, None,
    )


# ---------------------------------------------------------------------------
# Event temporal features (directive section 3). Each is a thin, honest
# derivation from an already-classified EventStateResult plus caller-supplied
# surface/flow observations -- these remain RESEARCH FEATURES only; no
# function here authorizes a trade, matching the directive's explicit
# instruction that no event state directly authorizes an option trade.
# ---------------------------------------------------------------------------

SECONDS_PER_TRADING_DAY = 6.5 * 3600.0  # regular-session length; caller may override at the call site if needed


@dataclass(frozen=True)
class EventTemporalFeatures:
    days_to_event: Optional[float]
    trading_days_to_event: Optional[float]  # approximate -- calendar-vs-trading-day distinction is NOT session-calendar-aware; treat as a rough research feature, never a scheduling authority
    expiry_crosses_event: Optional[bool]
    post_event_age_days: Optional[float]
    iv_change_into_event: Optional[float]
    term_change_into_event: Optional[float]
    skew_change_into_event: Optional[float]
    flow_change_into_event: Optional[float]
    iv_crush_after_event: Optional[float]  # pre-event IV minus post-event IV; None unless both are known and event has occurred


def derive_event_temporal_features(
    result: EventStateResult,
    iv_before_event: Optional[float] = None,
    iv_after_event: Optional[float] = None,
    iv_at_decision: Optional[float] = None,
    iv_reference: Optional[float] = None,
    term_at_decision: Optional[float] = None,
    term_reference: Optional[float] = None,
    skew_at_decision: Optional[float] = None,
    skew_reference: Optional[float] = None,
    flow_at_decision: Optional[float] = None,
    flow_reference: Optional[float] = None,
) -> EventTemporalFeatures:
    """Every *_change_into_event field is `current - reference`, where
    `reference` is a caller-supplied EARLIER observation of the same
    quantity -- this function performs no lookups and no forecasting, only
    arithmetic on values the caller has already sourced PIT-safely. Any
    missing operand produces None for that specific field, never a
    fabricated zero change."""
    days_to_event = (
        result.distance_to_event_seconds / 86400.0 if result.distance_to_event_seconds is not None
        and result.distance_to_event_seconds >= 0 else None
    )
    trading_days_to_event = (
        result.distance_to_event_seconds / SECONDS_PER_TRADING_DAY if result.distance_to_event_seconds is not None
        and result.distance_to_event_seconds >= 0 else None
    )
    post_event_age_days = (
        -result.distance_to_event_seconds / 86400.0 if result.distance_to_event_seconds is not None
        and result.distance_to_event_seconds < 0 else None
    )

    def _delta(current: Optional[float], reference: Optional[float]) -> Optional[float]:
        if current is None or reference is None:
            return None
        return current - reference

    iv_crush = None
    if result.state in (EventState.EVENT_OCCURRED, EventState.POST_EVENT_NORMALIZATION):
        # crush = before - after, a positive magnitude when IV fell post-event.
        iv_crush = _delta(iv_before_event, iv_after_event)

    return EventTemporalFeatures(
        days_to_event=days_to_event,
        trading_days_to_event=trading_days_to_event,
        expiry_crosses_event=result.expiry_crosses_event,
        post_event_age_days=post_event_age_days,
        iv_change_into_event=_delta(iv_at_decision, iv_reference),
        term_change_into_event=_delta(term_at_decision, term_reference),
        skew_change_into_event=_delta(skew_at_decision, skew_reference),
        flow_change_into_event=_delta(flow_at_decision, flow_reference),
        iv_crush_after_event=iv_crush,
    )
