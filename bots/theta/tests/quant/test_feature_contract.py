"""Tests for bots/theta/quant/features/feature_contract.py (work package 01)
and its TREND/MOMENTUM adapters (work package 02). Synthetic data only.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import (  # noqa: E402
    FeatureResult, FeatureResultState, FeatureTruthClass, feature_result_from_json_dict,
)
from features.trend import moving_average_slope, trend_feature_to_result  # noqa: E402
from features.momentum import horizon_return, momentum_feature_to_result  # noqa: E402


def _rising_closes(n: int, daily_return: float = 0.01, start: float = 100.0) -> list:
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


class TestFeatureResultContract(unittest.TestCase):
    def test_ok_state_requires_a_value(self):
        with self.assertRaises(ValueError):
            FeatureResult(
                feature_id="X", family="TREND", state=FeatureResultState.OK,
                truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=None, structured_value=None,
                units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
                freshness_seconds=None, coverage=None, version="v1",
            )

    def test_value_and_structured_value_are_mutually_exclusive(self):
        with self.assertRaises(ValueError):
            FeatureResult(
                feature_id="X", family="TREND", state=FeatureResultState.OK,
                truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=1.0, structured_value={"a": 1},
                units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
                freshness_seconds=None, coverage=None, version="v1",
            )

    def test_unknown_state_does_not_require_a_value(self):
        result = FeatureResult(
            feature_id="X", family="TREND", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
            freshness_seconds=None, coverage=None, version="v1",
        )
        self.assertIsNone(result.value)

    def test_serialization_reload_is_identical(self):
        result = FeatureResult(
            feature_id="X", family="TREND", state=FeatureResultState.OK,
            truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=0.05, structured_value=None,
            units="fractional", source_provider="p", source_operation="op", as_of="t1", retrieved_at="t2",
            freshness_seconds=1.5, coverage=0.9, version="v1", reason_codes=("A", "B"),
        )
        reloaded = feature_result_from_json_dict(result.to_json_dict())
        self.assertEqual(result, reloaded)
        self.assertEqual(result.content_hash(), reloaded.content_hash())

    def test_content_hash_is_deterministic_and_sensitive_to_value(self):
        base = dict(
            feature_id="X", family="TREND", state=FeatureResultState.OK,
            truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, structured_value=None,
            units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
            freshness_seconds=None, coverage=None, version="v1",
        )
        a = FeatureResult(value=1.0, **base)
        a_repeat = FeatureResult(value=1.0, **base)
        b = FeatureResult(value=2.0, **base)
        self.assertEqual(a.content_hash(), a_repeat.content_hash())
        self.assertNotEqual(a.content_hash(), b.content_hash())


class TestTrendMomentumAdapters(unittest.TestCase):
    def test_trend_feature_converts_to_canonical_result(self):
        raw = moving_average_slope(_rising_closes(40, daily_return=0.02), 39, ma_window=10, slope_window=5)
        result = trend_feature_to_result(raw, as_of="2026-09-27T00:00:00Z", retrieved_at="2026-09-27T00:00:01Z")
        self.assertEqual(result.family, "TREND")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.truth_class, FeatureTruthClass.DERIVED_FROM_OBSERVED)
        self.assertAlmostEqual(result.value, raw.slope)
        reloaded = feature_result_from_json_dict(result.to_json_dict())
        self.assertEqual(result, reloaded)

    def test_trend_insufficient_history_maps_to_canonical_state_never_a_fabricated_value(self):
        raw = moving_average_slope(_rising_closes(10), 9, ma_window=10, slope_window=5)
        result = trend_feature_to_result(raw, as_of="t", retrieved_at="t")
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_HISTORY)
        self.assertIsNone(result.value)

    def test_momentum_feature_converts_to_canonical_result(self):
        raw = horizon_return(_rising_closes(40, daily_return=0.02), 39, horizon=10)
        result = momentum_feature_to_result(raw, as_of="t", retrieved_at="t")
        self.assertEqual(result.family, "MOMENTUM")
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertAlmostEqual(result.value, raw.return_value)

    def test_trend_and_momentum_feature_ids_are_distinct(self):
        trend_result = trend_feature_to_result(
            moving_average_slope(_rising_closes(40), 39, ma_window=10, slope_window=5), as_of="t", retrieved_at="t")
        momentum_result = momentum_feature_to_result(
            horizon_return(_rising_closes(40), 39, horizon=10), as_of="t", retrieved_at="t")
        self.assertNotEqual(trend_result.feature_id, momentum_result.feature_id)
        self.assertNotEqual(trend_result.family, momentum_result.family)


if __name__ == "__main__":
    unittest.main()
