"""Tests for bots/theta/quant/research/point_in_time_join.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.point_in_time_join import (  # noqa: E402
    DuplicateObservationError,
    JoinFailureReason,
    TimestampedObservation,
    build_point_in_time_index,
    detect_out_of_order,
    join_as_of,
)


def _obs(key, as_of, value, source="ALPACA"):
    return TimestampedObservation(as_of=as_of, key=key, source=source, value=value)


class ExactJoinTests(unittest.TestCase):
    def test_an_exact_match_joins_correctly(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-10", 500.0)])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA")
        self.assertEqual(result.value, 500.0)
        self.assertIsNone(result.failure_reason)

    def test_missing_option_day_fails_missing_not_a_guess(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-10", 500.0)])
        result = join_as_of("SPY", "2026-09-11", index, "ALPACA")
        self.assertIsNone(result.value)
        self.assertEqual(result.failure_reason, JoinFailureReason.MISSING)

    def test_missing_stock_day_is_the_same_missing_semantics(self):
        index = build_point_in_time_index([_obs("QQQ", "2026-09-10", 400.0)])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA")
        self.assertEqual(result.failure_reason, JoinFailureReason.MISSING)

    def test_duplicate_date_with_identical_values_is_not_an_error(self):
        # Re-ingesting the same real value twice must not be conflated
        # with a genuine data conflict.
        index = build_point_in_time_index([
            _obs("SPY", "2026-09-10", 500.0),
            _obs("SPY", "2026-09-10", 500.0),
        ])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA")
        self.assertEqual(result.value, 500.0)

    def test_duplicate_date_with_conflicting_values_raises_rather_than_silently_picking_one(self):
        with self.assertRaises(DuplicateObservationError):
            build_point_in_time_index([
                _obs("SPY", "2026-09-10", 500.0),
                _obs("SPY", "2026-09-10", 501.0),
            ])

    def test_different_sources_for_the_same_key_and_date_never_collide(self):
        index = build_point_in_time_index([
            _obs("SPY", "2026-09-10", 500.0, source="ALPACA"),
            _obs("SPY", "2026-09-10", 501.0, source="OPTIONOMICS"),
        ])
        alpaca_result = join_as_of("SPY", "2026-09-10", index, "ALPACA")
        optionomics_result = join_as_of("SPY", "2026-09-10", index, "OPTIONOMICS")
        self.assertEqual(alpaca_result.value, 500.0)
        self.assertEqual(optionomics_result.value, 501.0)


class HolidayAndCalendarTests(unittest.TestCase):
    def test_a_non_trading_day_fails_holiday_not_missing(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-10", 500.0)])
        # 2026-09-12 is a Saturday, never in a real trading calendar.
        result = join_as_of("SPY", "2026-09-12", index, "ALPACA", trading_calendar=["2026-09-10", "2026-09-11"])
        self.assertEqual(result.failure_reason, JoinFailureReason.HOLIDAY)

    def test_a_confirmed_trading_day_with_no_data_still_fails_missing(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-10", 500.0)])
        result = join_as_of("SPY", "2026-09-11", index, "ALPACA", trading_calendar=["2026-09-10", "2026-09-11"])
        self.assertEqual(result.failure_reason, JoinFailureReason.MISSING)


class AsOfToleranceTests(unittest.TestCase):
    def test_within_tolerance_resolves_to_the_most_recent_prior_observation(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-08", 495.0)])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA", max_staleness_days=3)
        self.assertEqual(result.value, 495.0)
        self.assertEqual(result.resolved_from_as_of, "2026-09-08")
        self.assertIsNone(result.failure_reason)

    def test_beyond_tolerance_fails_stale_not_silently_returned(self):
        index = build_point_in_time_index([_obs("SPY", "2026-09-01", 490.0)])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA", max_staleness_days=3)
        self.assertEqual(result.failure_reason, JoinFailureReason.STALE)
        self.assertIsNone(result.value)

    def test_a_future_observation_never_satisfies_a_past_join_even_with_tolerance(self):
        # Only a FUTURE observation exists relative to as_of -- the
        # backward-only search must never reach forward and use it.
        index = build_point_in_time_index([_obs("SPY", "2026-09-15", 510.0)])
        result = join_as_of("SPY", "2026-09-10", index, "ALPACA", max_staleness_days=30)
        self.assertIsNone(result.value)
        self.assertEqual(result.failure_reason, JoinFailureReason.MISSING)

    def test_early_close_style_gap_is_bridged_within_tolerance_like_any_other_missing_day(self):
        # An early-close day contributing no new quote is indistinguishable,
        # from this module's perspective, from any other single missing day
        # -- it resolves via the same backward-tolerance mechanism.
        index = build_point_in_time_index([_obs("SPY", "2026-11-27", 505.0)])
        result = join_as_of("SPY", "2026-11-28", index, "ALPACA", max_staleness_days=1)
        self.assertEqual(result.value, 505.0)


class OutOfOrderAndFrequencyTests(unittest.TestCase):
    def test_out_of_order_series_is_detected(self):
        observations = [
            _obs("SPY", "2026-09-10", 500.0),
            _obs("SPY", "2026-09-08", 495.0),  # earlier date appended after a later one
        ]
        flagged = detect_out_of_order(observations)
        self.assertIn("SPY", flagged)

    def test_a_well_ordered_series_is_never_flagged(self):
        observations = [
            _obs("SPY", "2026-09-08", 495.0),
            _obs("SPY", "2026-09-09", 498.0),
            _obs("SPY", "2026-09-10", 500.0),
        ]
        self.assertEqual(detect_out_of_order(observations), [])

    def test_different_sampling_frequencies_across_two_keys_never_cross_contaminate(self):
        # SPY sampled daily, an illiquid option sampled only twice a week --
        # each key's own join must only ever see its own observations.
        observations = [
            _obs("SPY", "2026-09-08", 495.0), _obs("SPY", "2026-09-09", 498.0), _obs("SPY", "2026-09-10", 500.0),
            _obs("SPY261009P00500000", "2026-09-08", 1.10),
        ]
        index = build_point_in_time_index(observations)
        option_result = join_as_of("SPY261009P00500000", "2026-09-10", index, "ALPACA", max_staleness_days=5)
        self.assertEqual(option_result.value, 1.10)
        self.assertEqual(option_result.resolved_from_as_of, "2026-09-08")

    def test_stale_quote_beyond_tolerance_is_named_explicitly_never_silently_reused(self):
        index = build_point_in_time_index([_obs("SPY261009P00500000", "2026-08-01", 1.50)])
        result = join_as_of("SPY261009P00500000", "2026-09-10", index, "ALPACA", max_staleness_days=5)
        self.assertEqual(result.failure_reason, JoinFailureReason.STALE)


if __name__ == "__main__":
    unittest.main()
