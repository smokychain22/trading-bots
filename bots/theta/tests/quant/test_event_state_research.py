"""Tests for research/event_state_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.event_state_research import (  # noqa: E402
    EventKind,
    EventRecord,
    EventState,
    EventUnknownReason,
    classify_event_state,
    derive_event_temporal_features,
)

DECISION = "2026-09-15T14:00:00Z"
EXPIRATION = "2026-09-19T20:00:00Z"


def _event(**overrides):
    defaults = dict(kind=EventKind.EARNINGS, event_timestamp=None, source="test_source", freshness_seconds=1.0, max_freshness_seconds=None)
    defaults.update(overrides)
    return EventRecord(**defaults)


class ClassifyEventStateTests(unittest.TestCase):
    def test_missing_decision_or_expiration_timestamp_is_unknown(self):
        result = classify_event_state(_event(), None, EXPIRATION, 3 * 86400.0, 1 * 86400.0)
        self.assertEqual(result.state, EventState.EVENT_DATA_UNKNOWN)
        self.assertEqual(result.unknown_reason, EventUnknownReason.DECISION_OR_EXPIRATION_TIMESTAMP_MISSING)

    def test_missing_event_timestamp_without_confirmation_is_unknown_not_no_event(self):
        result = classify_event_state(_event(), DECISION, EXPIRATION, 3 * 86400.0, 1 * 86400.0)
        self.assertEqual(result.state, EventState.EVENT_DATA_UNKNOWN)
        self.assertEqual(result.unknown_reason, EventUnknownReason.EVENT_TIMESTAMP_MISSING)

    def test_confirmed_no_event_is_a_distinct_positive_state(self):
        result = classify_event_state(_event(confirmed_no_event=True), DECISION, EXPIRATION, 3 * 86400.0, 1 * 86400.0)
        self.assertEqual(result.state, EventState.NO_KNOWN_EVENT)

    def test_stale_source_beyond_bound_is_unknown(self):
        event = _event(event_timestamp="2026-09-18T20:00:00Z", freshness_seconds=500.0, max_freshness_seconds=60.0)
        result = classify_event_state(event, DECISION, EXPIRATION, 3 * 86400.0, 1 * 86400.0)
        self.assertEqual(result.state, EventState.EVENT_DATA_UNKNOWN)
        self.assertEqual(result.unknown_reason, EventUnknownReason.EVENT_SOURCE_STALE)

    def test_unparseable_event_timestamp_is_unknown(self):
        event = _event(event_timestamp="not-a-timestamp")
        result = classify_event_state(event, DECISION, EXPIRATION, 3 * 86400.0, 1 * 86400.0)
        self.assertEqual(result.state, EventState.EVENT_DATA_UNKNOWN)
        self.assertEqual(result.unknown_reason, EventUnknownReason.EVENT_TIMESTAMP_UNPARSEABLE)

    def test_event_far_outside_imminent_window_but_before_expiration_crosses_contract_life(self):
        # Event is > imminent window away, but still before expiration.
        event = _event(event_timestamp="2026-09-19T00:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, imminent_window_seconds=3600.0, normalization_window_seconds=86400.0)
        self.assertEqual(result.state, EventState.EVENT_INSIDE_CONTRACT_LIFE)
        self.assertTrue(result.expiry_crosses_event)

    def test_event_beyond_expiration_is_approaching_not_crossing(self):
        event = _event(event_timestamp="2026-09-25T00:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, imminent_window_seconds=3600.0, normalization_window_seconds=86400.0)
        self.assertEqual(result.state, EventState.EVENT_APPROACHING)
        self.assertFalse(result.expiry_crosses_event)

    def test_event_inside_imminent_window_is_imminent(self):
        event = _event(event_timestamp="2026-09-15T15:00:00Z")  # 1 hour after decision
        result = classify_event_state(event, DECISION, EXPIRATION, imminent_window_seconds=7200.0, normalization_window_seconds=86400.0)
        self.assertEqual(result.state, EventState.EVENT_IMMINENT)

    def test_event_at_or_before_decision_within_normalization_window_is_post_event_normalization(self):
        event = _event(event_timestamp="2026-09-15T10:00:00Z")  # 4 hours before decision
        result = classify_event_state(event, DECISION, EXPIRATION, imminent_window_seconds=3600.0, normalization_window_seconds=8 * 3600.0)
        self.assertEqual(result.state, EventState.POST_EVENT_NORMALIZATION)

    def test_event_long_before_decision_is_event_occurred(self):
        event = _event(event_timestamp="2026-09-01T10:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, imminent_window_seconds=3600.0, normalization_window_seconds=86400.0)
        self.assertEqual(result.state, EventState.EVENT_OCCURRED)

    def test_event_exactly_at_decision_time_is_post_event(self):
        result = classify_event_state(_event(event_timestamp=DECISION), DECISION, EXPIRATION, 3600.0, 86400.0)
        self.assertIn(result.state, (EventState.POST_EVENT_NORMALIZATION, EventState.EVENT_OCCURRED))
        self.assertEqual(result.distance_to_event_seconds, 0.0)


class EventTemporalFeatureTests(unittest.TestCase):
    def test_days_to_event_derived_from_positive_distance(self):
        event = _event(event_timestamp="2026-09-19T00:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, 3600.0, 86400.0)
        features = derive_event_temporal_features(result)
        self.assertIsNotNone(features.days_to_event)
        self.assertAlmostEqual(features.days_to_event, (result.distance_to_event_seconds or 0.0) / 86400.0)

    def test_missing_change_operand_yields_none_not_zero(self):
        event = _event(confirmed_no_event=True)
        result = classify_event_state(event, DECISION, EXPIRATION, 3600.0, 86400.0)
        features = derive_event_temporal_features(result, iv_at_decision=0.4, iv_reference=None)
        self.assertIsNone(features.iv_change_into_event)

    def test_iv_crush_only_computed_once_event_has_occurred(self):
        event = _event(event_timestamp="2026-09-01T10:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, 3600.0, 86400.0)
        self.assertEqual(result.state, EventState.EVENT_OCCURRED)
        features = derive_event_temporal_features(result, iv_before_event=0.6, iv_after_event=0.3)
        self.assertAlmostEqual(features.iv_crush_after_event, 0.3)

    def test_iv_crush_not_computed_before_event_occurs(self):
        event = _event(event_timestamp="2026-09-19T00:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, 3600.0, 86400.0)
        features = derive_event_temporal_features(result, iv_before_event=0.6, iv_after_event=0.3)
        self.assertIsNone(features.iv_crush_after_event)

    def test_expiry_crosses_event_propagated_from_state_result(self):
        event = _event(event_timestamp="2026-09-19T00:00:00Z")
        result = classify_event_state(event, DECISION, EXPIRATION, 3600.0, 86400.0)
        features = derive_event_temporal_features(result)
        self.assertEqual(features.expiry_crosses_event, result.expiry_crosses_event)


if __name__ == "__main__":
    unittest.main()
