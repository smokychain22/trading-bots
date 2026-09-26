"""Tests for bots/theta/quant/features/unusual_activity.py (work package 10)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState, FeatureTruthClass  # noqa: E402
from features.unusual_activity import UnusualActivityInput, robust_z_score, unusual_activity_result  # noqa: E402


def _input(**overrides) -> UnusualActivityInput:
    base = dict(
        option_symbol="SPY261016C00650000", current_metric=100.0,
        baseline_window=[50.0, 55.0, 48.0, 52.0, 51.0, 49.0, 53.0, 50.0, 47.0, 54.0],
        min_baseline_n=10, event_context_known=True, as_of="t", retrieved_at="t",
    )
    base.update(overrides)
    return UnusualActivityInput(**base)


class TestRobustZScore(unittest.TestCase):
    def test_zero_spread_baseline_returns_none_never_a_fabricated_score(self):
        self.assertIsNone(robust_z_score(10.0, [5.0, 5.0, 5.0]))

    def test_empty_baseline_returns_none(self):
        self.assertIsNone(robust_z_score(10.0, []))


class TestUnusualActivityResult(unittest.TestCase):
    def test_normal_baseline_is_not_unusual(self):
        result = unusual_activity_result(_input(current_metric=51.0))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertFalse(result.structured_value["isUnusual"])

    def test_spike_is_flagged_unusual(self):
        result = unusual_activity_result(_input(current_metric=5000.0))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertTrue(result.structured_value["isUnusual"])

    def test_tiny_baseline_is_insufficient_sample(self):
        result = unusual_activity_result(_input(baseline_window=[50.0, 51.0], min_baseline_n=10))
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_SAMPLE)
        self.assertIsNone(result.structured_value)

    def test_missing_history_is_insufficient_sample(self):
        result = unusual_activity_result(_input(baseline_window=[], min_baseline_n=10))
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_SAMPLE)

    def test_stale_provider_missing_current_metric_is_unknown(self):
        result = unusual_activity_result(_input(current_metric=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_event_day_ambiguity_downgrades_truth_class_to_modeled_research(self):
        result = unusual_activity_result(_input(current_metric=100.0, event_context_known=False))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.truth_class, FeatureTruthClass.MODELED_RESEARCH)
        self.assertIn("EVENT_CONTEXT_AMBIGUOUS", result.reason_codes[0])

    def test_never_a_bare_binary_output_includes_score_and_n(self):
        result = unusual_activity_result(_input())
        self.assertIn("score", result.structured_value)
        self.assertIn("baselineN", result.structured_value)
        self.assertIn("isUnusual", result.structured_value)


if __name__ == "__main__":
    unittest.main()
