"""Tests for research/position_path_state_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.position_path_state_research import (  # noqa: E402
    PathCheckpoint,
    PathCompletenessState,
    TradePathState,
    assess_path_completeness,
    assess_winner_to_loser,
    compute_path_state,
    compute_trajectory,
    distance_to_strike,
    dte_at,
)


def _cp(observed_at, pnl=None, delta=None, gamma=None, iv=None, underlying_price=None, complete=True):
    return PathCheckpoint(observed_at=observed_at, pnl=pnl, delta=delta, gamma=gamma, iv=iv,
                           underlying_price=underlying_price, is_known_peak_search_complete=complete)


class AssessPathCompletenessTests(unittest.TestCase):
    def test_empty_checkpoints_is_missing_peak_observation(self):
        self.assertEqual(assess_path_completeness([], False), PathCompletenessState.MISSING_PEAK_OBSERVATION)

    def test_event_overlap_dominates_everything_else(self):
        self.assertEqual(assess_path_completeness([_cp("2026-01-01T00:00:00Z")], True), PathCompletenessState.EVENT_AMBIGUOUS)

    def test_gap_flagged_checkpoint_is_partial(self):
        result = assess_path_completeness([_cp("2026-01-01T00:00:00Z", complete=False)], False)
        self.assertEqual(result, PathCompletenessState.PARTIAL_MISSING_INTERMEDIATE)

    def test_fully_covered_checkpoints_are_complete(self):
        result = assess_path_completeness([_cp("2026-01-01T00:00:00Z"), _cp("2026-01-02T00:00:00Z")], False)
        self.assertEqual(result, PathCompletenessState.COMPLETE)


class ComputePathStateTests(unittest.TestCase):
    def test_peak_and_trough_identified_by_pnl(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", pnl=0), _cp("2026-01-02T00:00:00Z", pnl=50),
                       _cp("2026-01-03T00:00:00Z", pnl=-10), _cp("2026-01-04T00:00:00Z", pnl=20)]
        snapshot = compute_path_state(checkpoints, False)
        self.assertEqual(snapshot.peak_by_pnl.pnl, 50)
        self.assertEqual(snapshot.trough_by_pnl.pnl, -10)
        self.assertEqual(snapshot.current.pnl, 20)

    def test_giveback_computed_from_peak_to_current(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", pnl=0), _cp("2026-01-02T00:00:00Z", pnl=50),
                       _cp("2026-01-03T00:00:00Z", pnl=20)]
        snapshot = compute_path_state(checkpoints, False)
        self.assertAlmostEqual(snapshot.profit_giveback, 30)

    def test_no_giveback_reported_without_a_peak_observation(self):
        snapshot = compute_path_state([], False)
        self.assertIsNone(snapshot.profit_giveback)

    def test_time_since_peak_computed(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", pnl=0), _cp("2026-01-01T10:00:00Z", pnl=50),
                       _cp("2026-01-01T12:00:00Z", pnl=20)]
        snapshot = compute_path_state(checkpoints, False)
        self.assertAlmostEqual(snapshot.time_since_peak_seconds, 2 * 3600.0)


class DteAtAndDistanceToStrikeTests(unittest.TestCase):
    def test_dte_at_computes_fractional_days(self):
        self.assertAlmostEqual(dte_at("2026-01-11T00:00:00Z", "2026-01-01T00:00:00Z"), 10.0)

    def test_dte_at_returns_none_for_unparseable_timestamp(self):
        self.assertIsNone(dte_at("not-a-date", "2026-01-01T00:00:00Z"))

    def test_distance_to_strike_absolute(self):
        self.assertAlmostEqual(distance_to_strike(105.0, 100.0, as_percent=False), 5.0)

    def test_distance_to_strike_percent(self):
        self.assertAlmostEqual(distance_to_strike(105.0, 100.0, as_percent=True), 0.05)

    def test_distance_to_strike_none_when_strike_zero(self):
        self.assertIsNone(distance_to_strike(105.0, 0.0, as_percent=True))


class ComputeTrajectoryTests(unittest.TestCase):
    def test_velocity_requires_at_least_two_known_points(self):
        result = compute_trajectory([_cp("2026-01-01T00:00:00Z", pnl=10)], "pnl")
        self.assertIsNone(result.velocity_per_hour)

    def test_velocity_computed_from_first_and_last(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", pnl=0), _cp("2026-01-01T02:00:00Z", pnl=20)]
        result = compute_trajectory(checkpoints, "pnl")
        self.assertAlmostEqual(result.velocity_per_hour, 10.0)
        self.assertIsNone(result.acceleration_per_hour_squared)

    def test_acceleration_requires_three_points(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", pnl=0), _cp("2026-01-01T01:00:00Z", pnl=10),
                       _cp("2026-01-01T02:00:00Z", pnl=40)]
        result = compute_trajectory(checkpoints, "pnl")
        self.assertIsNotNone(result.acceleration_per_hour_squared)
        self.assertGreater(result.acceleration_per_hour_squared, 0)  # accelerating gain

    def test_missing_field_values_are_skipped_not_treated_as_zero(self):
        checkpoints = [_cp("2026-01-01T00:00:00Z", delta=None), _cp("2026-01-01T02:00:00Z", delta=0.3)]
        result = compute_trajectory(checkpoints, "delta")
        self.assertIsNone(result.velocity_per_hour)


class AssessWinnerToLoserTests(unittest.TestCase):
    def test_missing_peak_or_current_is_unclassified(self):
        result = assess_winner_to_loser(None, -5.0, None, None, minimum_material_giveback=10.0)
        self.assertEqual(result.state, TradePathState.UNCLASSIFIED)

    def test_small_giveback_is_normal(self):
        result = assess_winner_to_loser(peak_pnl=20.0, current_pnl=15.0, giveback_velocity_per_hour=None,
                                         delta_deteriorated=None, minimum_material_giveback=10.0)
        self.assertEqual(result.state, TradePathState.NORMAL_GIVEBACK)

    def test_crossing_from_profit_to_loss_after_peak_is_winner_to_loser(self):
        result = assess_winner_to_loser(peak_pnl=25.0, current_pnl=-5.0, giveback_velocity_per_hour=None,
                                         delta_deteriorated=None, minimum_material_giveback=10.0)
        self.assertEqual(result.state, TradePathState.WINNER_TO_LOSER)

    def test_material_giveback_still_profitable_with_deteriorating_context_is_edge_deterioration(self):
        result = assess_winner_to_loser(peak_pnl=50.0, current_pnl=20.0, giveback_velocity_per_hour=5.0,
                                         delta_deteriorated=True, minimum_material_giveback=10.0)
        self.assertEqual(result.state, TradePathState.MATERIAL_EDGE_DETERIORATION)

    def test_material_giveback_still_profitable_without_deterioration_context_is_a_warning_not_a_close(self):
        result = assess_winner_to_loser(peak_pnl=50.0, current_pnl=35.0, giveback_velocity_per_hour=None,
                                         delta_deteriorated=False, minimum_material_giveback=10.0)
        self.assertEqual(result.state, TradePathState.WINNER_TO_LOSER_WARNING)

    def test_a_stable_at_negative_5_pct_position_differs_from_one_that_peaked_at_25_then_fell(self):
        # The directive's own worked example: same current P&L, different path.
        stable = assess_winner_to_loser(peak_pnl=-2.0, current_pnl=-5.0, giveback_velocity_per_hour=None,
                                         delta_deteriorated=None, minimum_material_giveback=10.0)
        fell = assess_winner_to_loser(peak_pnl=25.0, current_pnl=-5.0, giveback_velocity_per_hour=None,
                                       delta_deteriorated=None, minimum_material_giveback=10.0)
        self.assertNotEqual(stable.state, fell.state)
        self.assertEqual(fell.state, TradePathState.WINNER_TO_LOSER)


if __name__ == "__main__":
    unittest.main()
