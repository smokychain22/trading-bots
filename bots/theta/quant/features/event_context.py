"""EVENT_CONTEXT feature (THETA long-run build, work package 12, Phase 2
feature family: EVENT_CONTEXT).

PIT-safe event-proximity classification for a real, already-scheduled
event (earnings, a corporate action, or a macro-calendar event only when
an authorized canonical source names one -- this module never invents a
macro event class). Never leaks future disclosure: `known_at` (when the
schedule itself became known) must be <= `as_of` (the decision moment), or
the observation is rejected as invalid, not silently used.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class EventContextObservation:
    underlying_symbol: str
    event_type: str  # "EARNINGS" | "CORPORATE_ACTION" | "MACRO_CALENDAR"
    scheduled_timestamp: Optional[str]  # None when no scheduled event is known
    known_at: Optional[str]  # when the schedule itself was published/observed
    source: str
    as_of: str
    retrieved_at: str


_KNOWN_EVENT_TYPES = ("EARNINGS", "CORPORATE_ACTION", "MACRO_CALENDAR")


def event_context_result(observation: EventContextObservation, version: str = "event-context-v1") -> FeatureResult:
    feature_id = f"EVENT_CONTEXT_{observation.event_type}_{observation.underlying_symbol}"
    if observation.event_type not in _KNOWN_EVENT_TYPES:
        return FeatureResult(
            feature_id=feature_id, family="EVENT_CONTEXT", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="days_to_event", source_provider=observation.source, source_operation="event_context_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=(f"EVENT_CONTEXT_INVALID:unknown_event_type={observation.event_type}",),
        )
    if observation.scheduled_timestamp is None:
        return FeatureResult(
            feature_id=feature_id, family="EVENT_CONTEXT", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="days_to_event", source_provider=observation.source, source_operation="event_context_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=("EVENT_CONTEXT_UNKNOWN:no_scheduled_event",),
        )
    if observation.known_at is None:
        return FeatureResult(
            feature_id=feature_id, family="EVENT_CONTEXT", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="days_to_event", source_provider=observation.source, source_operation="event_context_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=("EVENT_CONTEXT_UNKNOWN:known_at_missing",),
        )
    known_at = _parse_iso(observation.known_at)
    as_of = _parse_iso(observation.as_of)
    if known_at > as_of:
        # Future disclosure leakage: the schedule was not actually known at
        # the decision moment. Reject explicitly -- never silently use it.
        return FeatureResult(
            feature_id=feature_id, family="EVENT_CONTEXT", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="days_to_event", source_provider=observation.source, source_operation="event_context_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=("EVENT_CONTEXT_INVALID:known_at_after_as_of_future_leakage",),
        )
    scheduled = _parse_iso(observation.scheduled_timestamp)
    distance_days = (scheduled - as_of).total_seconds() / 86400.0
    return FeatureResult(
        feature_id=feature_id, family="EVENT_CONTEXT", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={
            "eventType": observation.event_type, "scheduledTimestamp": observation.scheduled_timestamp,
            "distanceDays": distance_days, "isPast": distance_days < 0, "knownAt": observation.known_at,
        },
        units="days_to_event", source_provider=observation.source, source_operation="event_context_result",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
        version=version, reason_codes=("EVENT_CONTEXT_OK",),
    )
