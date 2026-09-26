"""Tests for bots/theta/quant/features/flow.py (work package 09)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.flow import (  # noqa: E402
    RawFlowObservation, aggregate_flow_window, flow_feature_result, normalize_flow_observation,
)


def _raw(observed_at: str, premium: float = 1000.0, option_type: str = "CALL", direction=None, volume: int = 10):
    return RawFlowObservation(
        option_symbol="SPY261016C00650000", underlying_symbol="SPY", premium=premium, volume=volume,
        option_type=option_type, direction=direction, category=None, observed_at=observed_at, retrieved_at=observed_at,
    )


class TestFlowNormalization(unittest.TestCase):
    def test_invalid_option_type_normalizes_to_none(self):
        self.assertIsNone(normalize_flow_observation(_raw("t", option_type="STRADDLE")))

    def test_valid_call_normalizes(self):
        normalized = normalize_flow_observation(_raw("t", option_type="CALL"))
        self.assertIsNotNone(normalized)
        self.assertTrue(normalized.is_call)

    def test_unproven_direction_is_never_invented(self):
        normalized = normalize_flow_observation(_raw("t", direction=None))
        self.assertIsNone(normalized.raw.direction)


class TestFlowWindowAggregate(unittest.TestCase):
    def test_multiple_observations_aggregate_correctly(self):
        rows = [
            normalize_flow_observation(_raw("2026-09-27T10:00:00Z", premium=1000.0, option_type="CALL", direction="BUY")),
            normalize_flow_observation(_raw("2026-09-27T10:01:00Z", premium=500.0, option_type="PUT", direction="SELL")),
        ]
        aggregate = aggregate_flow_window(rows, "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate.observation_count, 2)
        self.assertAlmostEqual(aggregate.total_premium, 1500.0)
        self.assertAlmostEqual(aggregate.call_premium, 1000.0)
        self.assertAlmostEqual(aggregate.put_premium, 500.0)
        self.assertAlmostEqual(aggregate.buy_premium, 1000.0)
        self.assertAlmostEqual(aggregate.sell_premium, 500.0)

    def test_window_cutoff_excludes_observations_after_window_end(self):
        rows = [normalize_flow_observation(_raw("2026-09-27T12:00:00Z"))]
        aggregate = aggregate_flow_window(rows, "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate.observation_count, 0)

    def test_future_observation_exclusion_is_the_pit_cutoff(self):
        past = normalize_flow_observation(_raw("2026-09-27T10:00:00Z"))
        future = normalize_flow_observation(_raw("2026-09-27T23:00:00Z"))
        aggregate_without_future = aggregate_flow_window([past], "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        aggregate_with_future = aggregate_flow_window([past, future], "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate_without_future.total_premium, aggregate_with_future.total_premium)

    def test_late_retrieval_before_window_start_is_excluded(self):
        rows = [normalize_flow_observation(_raw("2026-09-27T08:00:00Z"))]
        aggregate = aggregate_flow_window(rows, "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate.observation_count, 0)

    def test_missing_source_is_zero_observations_not_a_crash(self):
        aggregate = aggregate_flow_window([], "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate.observation_count, 0)
        self.assertEqual(aggregate.total_premium, 0.0)

    def test_partial_fields_do_not_break_aggregation(self):
        partial = RawFlowObservation(
            option_symbol="SPY261016C00650000", underlying_symbol="SPY", premium=None, volume=None,
            option_type="CALL", direction=None, category=None,
            observed_at="2026-09-27T10:00:00Z", retrieved_at="2026-09-27T10:00:00Z",
        )
        normalized = normalize_flow_observation(partial)
        aggregate = aggregate_flow_window([normalized], "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        self.assertEqual(aggregate.observation_count, 1)
        self.assertEqual(aggregate.total_premium, 0.0)


class TestFlowFeatureResult(unittest.TestCase):
    def test_ok_when_min_observations_met(self):
        rows = [normalize_flow_observation(_raw("2026-09-27T10:00:00Z"))]
        aggregate = aggregate_flow_window(rows, "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        result = flow_feature_result(aggregate, "SPY", "t", "t", min_observations=1)
        self.assertEqual(result.state, FeatureResultState.OK)

    def test_insufficient_coverage_below_minimum(self):
        aggregate = aggregate_flow_window([], "2026-09-27T09:00:00Z", "2026-09-27T11:00:00Z")
        result = flow_feature_result(aggregate, "SPY", "t", "t", min_observations=1)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)
        self.assertIsNone(result.structured_value)


if __name__ == "__main__":
    unittest.main()
