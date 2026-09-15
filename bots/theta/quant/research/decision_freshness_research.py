"""Decision-freshness research (P2D-continuation directive, sections
13-14): when does a past research decision (a rejection, an approval, a
WAIT classification) become stale, and what re-evaluation triggers should
invalidate it -- so a morning rejection does not silently remain "valid"
all afternoon.

This module never specifies polling cadence or wall-clock rules (the
directive's own explicit instruction: "do not recommend universal
hardcoded wall-clock times... this is decision freshness logic, not
hyperactive polling"). Every invalidation bound is caller-supplied and
caller-justified, matching this package's standing no-invented-threshold
discipline.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional


class InvalidationReason(str, Enum):
    QUOTE_AGE_EXCEEDED = "QUOTE_AGE_EXCEEDED"
    SPOT_MOVED_BEYOND_BOUND = "SPOT_MOVED_BEYOND_BOUND"
    IV_MOVED_BEYOND_BOUND = "IV_MOVED_BEYOND_BOUND"
    DELTA_REGIME_CHANGED = "DELTA_REGIME_CHANGED"
    FLOW_REVERSED = "FLOW_REVERSED"
    GEX_REGIME_CHANGED = "GEX_REGIME_CHANGED"
    SESSION_STATE_TRANSITIONED = "SESSION_STATE_TRANSITIONED"
    EVENT_STATE_TRANSITIONED = "EVENT_STATE_TRANSITIONED"
    PORTFOLIO_CHANGED = "PORTFOLIO_CHANGED"
    TIME_DECAY_EXCEEDED = "TIME_DECAY_EXCEEDED"  # DTE itself moved enough that theta/gamma character changed, independent of price


@dataclass(frozen=True)
class DecisionFreshnessBounds:
    """Every bound is Optional[float]; a bound left None means that
    invalidator is not checked for this decision class -- callers must
    opt in per bound, never inherit a silent universal default."""

    max_quote_age_seconds: Optional[float] = None
    max_spot_move_fraction: Optional[float] = None
    max_iv_move_absolute: Optional[float] = None
    max_time_decay_seconds: Optional[float] = None


@dataclass(frozen=True)
class DecisionFreshnessObservation:
    """The caller-supplied CURRENT state to re-check a past decision
    against. Categorical fields (delta_regime/flow_direction/gex_regime/
    session_state/event_state) are compared for EQUALITY against the
    decision-time value the caller also supplies -- any change invalidates,
    since this module has no notion of "how much" a categorical state
    may drift before it matters; that judgment belongs to the caller who
    defined the categories."""

    observed_at: str
    quote_age_seconds: Optional[float]
    spot_price: Optional[float]
    iv: Optional[float]
    delta_regime: Optional[str]
    flow_direction: Optional[str]
    gex_regime: Optional[str]
    session_state: Optional[str]
    event_state: Optional[str]
    portfolio_fingerprint: Optional[str]  # a caller-computed hash/version of portfolio state; any change = PORTFOLIO_CHANGED


@dataclass(frozen=True)
class DecisionContext:
    """The frozen state a past decision was made against -- mirrors the
    fields DecisionFreshnessObservation carries, captured at decision time."""

    decision_created_at: str
    spot_price: Optional[float]
    iv: Optional[float]
    delta_regime: Optional[str]
    flow_direction: Optional[str]
    gex_regime: Optional[str]
    session_state: Optional[str]
    event_state: Optional[str]
    portfolio_fingerprint: Optional[str]
    expiration: Optional[str]  # for TIME_DECAY_EXCEEDED, compared against the observation's own implied DTE-at-observation


@dataclass(frozen=True)
class DecisionFreshnessResult:
    decision_created_at: str
    decision_valid_until: Optional[str]  # None if no expiry bound was ever set (freshness governed purely by invalidation triggers below)
    decision_invalidated_at: Optional[str]
    invalidation_reasons: List[InvalidationReason]
    still_fresh: bool


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def assess_decision_freshness(
    context: DecisionContext, observation: DecisionFreshnessObservation, bounds: DecisionFreshnessBounds,
) -> DecisionFreshnessResult:
    """Checks every configured re-evaluation trigger and reports EVERY
    one that fired, never just the first -- a caller reviewing a stale
    decision should see the full picture, matching this package's
    existing multi-reason-reporting convention
    (`assess_model_fit_sufficiency`, `resolveOutcome`'s reasonCodes)."""
    reasons: List[InvalidationReason] = []

    if bounds.max_quote_age_seconds is not None:
        if observation.quote_age_seconds is None or observation.quote_age_seconds > bounds.max_quote_age_seconds:
            reasons.append(InvalidationReason.QUOTE_AGE_EXCEEDED)

    if bounds.max_spot_move_fraction is not None:
        if context.spot_price is None or observation.spot_price is None or context.spot_price == 0:
            reasons.append(InvalidationReason.SPOT_MOVED_BEYOND_BOUND)
        else:
            moved = abs(observation.spot_price - context.spot_price) / context.spot_price
            if moved > bounds.max_spot_move_fraction:
                reasons.append(InvalidationReason.SPOT_MOVED_BEYOND_BOUND)

    if bounds.max_iv_move_absolute is not None:
        if context.iv is None or observation.iv is None or abs(observation.iv - context.iv) > bounds.max_iv_move_absolute:
            reasons.append(InvalidationReason.IV_MOVED_BEYOND_BOUND)

    if context.delta_regime is not None and observation.delta_regime is not None and context.delta_regime != observation.delta_regime:
        reasons.append(InvalidationReason.DELTA_REGIME_CHANGED)
    if context.flow_direction is not None and observation.flow_direction is not None and context.flow_direction != observation.flow_direction:
        reasons.append(InvalidationReason.FLOW_REVERSED)
    if context.gex_regime is not None and observation.gex_regime is not None and context.gex_regime != observation.gex_regime:
        reasons.append(InvalidationReason.GEX_REGIME_CHANGED)
    if context.session_state is not None and observation.session_state is not None and context.session_state != observation.session_state:
        reasons.append(InvalidationReason.SESSION_STATE_TRANSITIONED)
    if context.event_state is not None and observation.event_state is not None and context.event_state != observation.event_state:
        reasons.append(InvalidationReason.EVENT_STATE_TRANSITIONED)
    if context.portfolio_fingerprint is not None and observation.portfolio_fingerprint is not None and context.portfolio_fingerprint != observation.portfolio_fingerprint:
        reasons.append(InvalidationReason.PORTFOLIO_CHANGED)

    if bounds.max_time_decay_seconds is not None:
        created_dt, observed_dt = _parse(context.decision_created_at), _parse(observation.observed_at)
        if created_dt is None or observed_dt is None or (observed_dt - created_dt).total_seconds() > bounds.max_time_decay_seconds:
            reasons.append(InvalidationReason.TIME_DECAY_EXCEEDED)

    still_fresh = len(reasons) == 0
    valid_until = None
    if bounds.max_time_decay_seconds is not None:
        created_dt = _parse(context.decision_created_at)
        if created_dt is not None:
            valid_until = (created_dt.timestamp() + bounds.max_time_decay_seconds)
            valid_until = datetime.fromtimestamp(valid_until, tz=timezone.utc).isoformat()

    return DecisionFreshnessResult(
        decision_created_at=context.decision_created_at,
        decision_valid_until=valid_until,
        decision_invalidated_at=observation.observed_at if not still_fresh else None,
        invalidation_reasons=reasons,
        still_fresh=still_fresh,
    )
