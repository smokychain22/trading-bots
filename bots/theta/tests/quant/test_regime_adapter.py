"""Tests for bots/theta/quant/features/regime_adapter.py (work package 18):
end-to-end TREND/REALIZED_VOLATILITY FeatureResult -> RegimeInputs ->
the REAL, unmodified regime_v0.classify() -- proving the first genuine
consumer wiring for this session's TREND/REALIZED_VOLATILITY producers.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.trend import moving_average_slope, trend_feature_to_result  # noqa: E402
from features.realized_volatility import close_to_close_realized_volatility_result  # noqa: E402
from features.regime_adapter import regime_inputs_from_features  # noqa: E402
from models.regime_v0 import RegimePolicyV0, TrendState, VolatilityState, classify  # noqa: E402


POLICY = RegimePolicyV0(
    policy_version="test-v1", bull_ma_slope_floor=0.01, bear_ma_slope_ceiling=-0.01,
    rv_low_ceiling=0.10, rv_high_floor=0.30, rv_shock_floor=0.60,
    max_adverse_gap_shock_threshold=0.15, liquidity_thin_spread_pct_floor=0.02,
    liquidity_dislocated_spread_pct_floor=0.05, correction_drawdown_ceiling=-0.10,
    crisis_drawdown_ceiling=-0.20,
)


def _rising_closes(n: int, daily_return: float, start: float = 100.0):
    closes = [start]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1.0 + daily_return))
    return closes


def _varying_closes(n: int, base_return: float, start: float = 100.0):
    closes = [start]
    for i in range(n - 1):
        closes.append(closes[-1] * (1.0 + (base_return if i % 2 == 0 else base_return * 0.5)))
    return closes


class TestRegimeAdapterEndToEnd(unittest.TestCase):
    def test_bull_regime_from_real_trend_feature(self):
        closes = _rising_closes(40, daily_return=0.02)
        trend_raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        rv_result = close_to_close_realized_volatility_result(closes, 39, window=20)
        inputs = regime_inputs_from_features(trend_result, rv_result)
        snapshot = classify(inputs, POLICY)
        self.assertEqual(snapshot.trend_state, TrendState.BULL)

    def test_bear_regime_from_real_trend_feature(self):
        closes = _rising_closes(40, daily_return=-0.02)
        trend_raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        inputs = regime_inputs_from_features(trend_result, None)
        snapshot = classify(inputs, POLICY)
        self.assertEqual(snapshot.trend_state, TrendState.BEAR)

    def test_range_regime_from_flat_trend(self):
        closes = _rising_closes(40, daily_return=0.0)
        trend_raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        inputs = regime_inputs_from_features(trend_result, None)
        snapshot = classify(inputs, POLICY)
        self.assertEqual(snapshot.trend_state, TrendState.RANGE)

    def test_high_vol_regime_from_real_realized_vol_feature(self):
        closes = _varying_closes(40, base_return=0.20)
        rv_result = close_to_close_realized_volatility_result(closes, 39, window=20)
        self.assertEqual(rv_result.state.value, "OK")
        inputs = regime_inputs_from_features(None, rv_result)
        snapshot = classify(inputs, POLICY)
        self.assertIn(snapshot.volatility_state, (VolatilityState.HIGH, VolatilityState.SHOCK))

    def test_unknown_when_feature_not_ok(self):
        closes = _rising_closes(5, daily_return=0.01)  # too short -> INSUFFICIENT_HISTORY
        trend_raw = moving_average_slope(closes, 4, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        inputs = regime_inputs_from_features(trend_result, None)
        self.assertIsNone(inputs.ma_slope)
        snapshot = classify(inputs, POLICY)
        self.assertIsNone(snapshot.trend_state)

    def test_partial_confidence_when_only_some_axes_resolvable(self):
        closes = _rising_closes(40, daily_return=0.02)
        trend_raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        inputs = regime_inputs_from_features(trend_result, None)  # rv20, event, liquidity, stress all None
        snapshot = classify(inputs, POLICY)
        self.assertLess(snapshot.confidence, 1.0)
        self.assertGreater(snapshot.confidence, 0.0)

    def test_wrong_family_rejected(self):
        closes = _rising_closes(40, daily_return=0.02)
        trend_raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        trend_result = trend_feature_to_result(trend_raw, as_of="t", retrieved_at="t")
        with self.assertRaises(ValueError):
            regime_inputs_from_features(None, trend_result)  # a TREND result passed as realized_vol_result


if __name__ == "__main__":
    unittest.main()
