"""Tests for bots/theta/quant/research/optionomics_flow_temporal_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_flow_temporal_research import (  # noqa: E402
    FlowDirection,
    FlowTemporalState,
    FlowWindowObservation,
    classify_flow_direction,
    derive_flow_delta,
)


def _obs(net_premium, observed_at, underlying="AAPL", window_label="CURRENT_5MIN"):
    return FlowWindowObservation(underlying=underlying, observed_at=observed_at, net_premium=net_premium, window_label=window_label)


class DeriveFlowDeltaTests(unittest.TestCase):
    def test_known_case_computes_change_and_rate(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z")
        current = _obs(1500.0, "2026-09-15T14:05:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.KNOWN)
        self.assertAlmostEqual(result.absolute_change, 500.0)
        self.assertAlmostEqual(result.elapsed_seconds, 300.0)
        self.assertAlmostEqual(result.rate_per_hour, 6000.0)

    def test_underlying_mismatch_is_invalid(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z", underlying="AAPL")
        current = _obs(1500.0, "2026-09-15T14:05:00Z", underlying="MSFT")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.INVALID)
        self.assertEqual(result.reason_code, "UNDERLYING_MISMATCH")

    def test_window_label_mismatch_is_unknown(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z", window_label="CURRENT_5MIN")
        current = _obs(1500.0, "2026-09-15T14:05:00Z", window_label="CURRENT_1HOUR")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.UNKNOWN)

    def test_reversed_order_is_invalid_not_negated(self):
        earlier = _obs(1000.0, "2026-09-15T14:05:00Z")
        current = _obs(1500.0, "2026-09-15T14:00:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.INVALID)
        self.assertEqual(result.reason_code, "OBSERVATIONS_NOT_STRICTLY_TIME_ORDERED")

    def test_equal_timestamps_is_invalid(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z")
        current = _obs(1500.0, "2026-09-15T14:00:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.INVALID)

    def test_gap_exceeding_policy_is_unknown(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z")
        current = _obs(1500.0, "2026-09-15T15:00:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.UNKNOWN)
        self.assertEqual(result.reason_code, "OBSERVATION_GAP_EXCEEDS_POLICY")

    def test_missing_net_premium_is_unknown(self):
        earlier = _obs(None, "2026-09-15T14:00:00Z")
        current = _obs(1500.0, "2026-09-15T14:05:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=600)
        self.assertEqual(result.state, FlowTemporalState.UNKNOWN)

    def test_invalid_maximum_gap_is_invalid(self):
        earlier = _obs(1000.0, "2026-09-15T14:00:00Z")
        current = _obs(1500.0, "2026-09-15T14:05:00Z")
        result = derive_flow_delta(earlier, current, maximum_gap_seconds=0)
        self.assertEqual(result.state, FlowTemporalState.INVALID)


class ClassifyFlowDirectionTests(unittest.TestCase):
    def test_requires_exactly_three_observations(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1200.0, "2026-09-15T14:05:00Z")]
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.UNKNOWN)

    def test_accelerating_same_sign_growing_magnitude(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1100.0, "2026-09-15T14:05:00Z"), _obs(1400.0, "2026-09-15T14:10:00Z")]
        # change_one = 100, change_two = 300 -> magnitude grew a lot
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.ACCELERATING)

    def test_decelerating_same_sign_shrinking_magnitude(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1300.0, "2026-09-15T14:05:00Z"), _obs(1350.0, "2026-09-15T14:10:00Z")]
        # change_one = 300, change_two = 50 -> magnitude shrank a lot
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.DECELERATING)

    def test_reversing_sign_flip(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1300.0, "2026-09-15T14:05:00Z"), _obs(1000.0, "2026-09-15T14:10:00Z")]
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.REVERSING)

    def test_persistent_within_tolerance(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1100.0, "2026-09-15T14:05:00Z"), _obs(1205.0, "2026-09-15T14:10:00Z")]
        # change_one = 100, change_two = 105 -> 5% relative change, within a 10% tolerance
        self.assertEqual(classify_flow_direction(obs, 600, 0.10), FlowDirection.PERSISTENT)

    def test_flat_period_is_unknown_not_a_direction(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1000.0, "2026-09-15T14:05:00Z"), _obs(1100.0, "2026-09-15T14:10:00Z")]
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.UNKNOWN)

    def test_a_gap_violation_in_either_delta_is_unknown(self):
        obs = [_obs(1000.0, "2026-09-15T14:00:00Z"), _obs(1100.0, "2026-09-15T15:05:00Z"), _obs(1400.0, "2026-09-15T15:10:00Z")]
        self.assertEqual(classify_flow_direction(obs, 600, 0.1), FlowDirection.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
