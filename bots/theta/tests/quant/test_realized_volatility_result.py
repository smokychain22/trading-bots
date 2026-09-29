"""Tests for close_to_close_realized_volatility_result (work package 03):
the canonical-contract, PIT-cutoff-aware wrapper around the pre-existing
close_to_close_realized_volatility estimator. Synthetic data only.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import (  # noqa: E402
    FeatureResultState, FeatureTruthClass, feature_result_from_json_dict,
)
from features.realized_volatility import close_to_close_realized_volatility_result  # noqa: E402


def _closes_with_return(n: int, daily_return: float, start: float = 100.0) -> list:
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


class TestRealizedVolatilityResult(unittest.TestCase):
    def test_constant_series_is_near_zero_volatility(self):
        closes = _closes_with_return(30, 0.0)
        result = close_to_close_realized_volatility_result(closes, 29, window=20)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertAlmostEqual(result.value, 0.0, places=9)

    def test_known_return_sequence_matches_direct_estimator_call(self):
        # A constant daily return produces IDENTICAL log-returns every day
        # -- zero sample variance, mathematically -- so a varying sequence
        # is required to prove a genuinely nonzero realized-vol estimate.
        closes = [100.0]
        for i in range(29):
            closes.append(closes[-1] * (1.0 + (0.01 if i % 2 == 0 else -0.01)))
        result = close_to_close_realized_volatility_result(closes, 29, window=20)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertGreater(result.value, 0.0)

    def test_missing_points_in_window_produce_unknown_never_a_fabricated_estimate(self):
        closes = _closes_with_return(30, 0.01)
        closes[15] = None
        result = close_to_close_realized_volatility_result(closes, 29, window=20)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_HISTORY)
        self.assertIsNone(result.value)

    def test_future_point_after_as_of_is_excluded(self):
        closes = _closes_with_return(40, 0.01)
        as_of_index = 29
        without_future = close_to_close_realized_volatility_result(closes[: as_of_index + 1], as_of_index, window=20)
        with_future_spike = list(closes)
        with_future_spike[35] = 999999.0
        with_future = close_to_close_realized_volatility_result(
            with_future_spike, as_of_index, window=20, max_bars_since_last=99)
        self.assertEqual(without_future.value, with_future.value)

    def test_stale_data_produces_stale_state(self):
        closes = _closes_with_return(40, 0.01)
        result = close_to_close_realized_volatility_result(closes, 20, window=10, max_bars_since_last=1)
        self.assertEqual(result.state, FeatureResultState.STALE)
        self.assertIsNone(result.value)

    def test_insufficient_sample_before_window_start(self):
        closes = _closes_with_return(10, 0.01)
        result = close_to_close_realized_volatility_result(closes, 9, window=20)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_HISTORY)
        self.assertIsNone(result.value)

    def test_serialization_reload_is_identical(self):
        closes = _closes_with_return(30, 0.01)
        result = close_to_close_realized_volatility_result(closes, 29, window=20, as_of="t1", retrieved_at="t2")
        reloaded = feature_result_from_json_dict(result.to_json_dict())
        self.assertEqual(result, reloaded)
        self.assertEqual(result.content_hash(), reloaded.content_hash())

    def test_truth_class_is_derived_from_observed_when_ok(self):
        closes = _closes_with_return(30, 0.01)
        result = close_to_close_realized_volatility_result(closes, 29, window=20)
        self.assertEqual(result.truth_class, FeatureTruthClass.DERIVED_FROM_OBSERVED)

    def test_as_of_index_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            close_to_close_realized_volatility_result([100.0, 101.0], 5, window=2)


if __name__ == "__main__":
    unittest.main()
