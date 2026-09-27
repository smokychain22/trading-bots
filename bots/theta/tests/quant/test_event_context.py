"""Tests for bots/theta/quant/features/event_context.py (work package 12)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.event_context import EventContextObservation, event_context_result  # noqa: E402


def _obs(**overrides) -> EventContextObservation:
    base = dict(
        underlying_symbol="SPY", event_type="EARNINGS", scheduled_timestamp="2026-10-20T20:00:00Z",
        known_at="2026-09-01T00:00:00Z", source="OPTIONOMICS",
        as_of="2026-09-27T14:00:00Z", retrieved_at="2026-09-27T14:00:01Z",
    )
    base.update(overrides)
    return EventContextObservation(**base)


class TestEventContextResult(unittest.TestCase):
    def test_upcoming_earnings_reports_distance(self):
        result = event_context_result(_obs())
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertGreater(result.structured_value["distanceDays"], 0)
        self.assertFalse(result.structured_value["isPast"])

    def test_no_scheduled_event_is_unknown(self):
        result = event_context_result(_obs(scheduled_timestamp=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_unknown_event_type_is_invalid(self):
        result = event_context_result(_obs(event_type="RUMOR"))
        self.assertEqual(result.state, FeatureResultState.INVALID)

    def test_future_disclosure_leakage_is_rejected(self):
        # known_at is AFTER as_of -- the schedule could not honestly have
        # been known at the decision moment.
        result = event_context_result(_obs(known_at="2026-09-28T00:00:00Z", as_of="2026-09-27T14:00:00Z"))
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIn("future_leakage", result.reason_codes[0])

    def test_missing_known_at_is_unknown(self):
        result = event_context_result(_obs(known_at=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_past_event_is_marked_past(self):
        result = event_context_result(_obs(scheduled_timestamp="2026-08-01T00:00:00Z", known_at="2026-07-01T00:00:00Z"))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertTrue(result.structured_value["isPast"])
        self.assertLess(result.structured_value["distanceDays"], 0)

    def test_corporate_action_and_macro_calendar_accepted(self):
        for event_type in ("CORPORATE_ACTION", "MACRO_CALENDAR"):
            result = event_context_result(_obs(event_type=event_type))
            self.assertEqual(result.state, FeatureResultState.OK)


if __name__ == "__main__":
    unittest.main()
