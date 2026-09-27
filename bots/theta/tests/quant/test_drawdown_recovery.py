"""Tests for bots/theta/quant/features/drawdown_recovery.py (work package 16)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.drawdown_recovery import DrawdownRecoveryInput, drawdown_recovery_result  # noqa: E402


class TestDrawdownRecoveryResult(unittest.TestCase):
    def test_at_high_water_mark_zero_drawdown(self):
        curve = [100.0, 105.0, 110.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=2))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["currentDrawdownPct"], 0.0)
        self.assertEqual(result.structured_value["recoveryState"], "AT_HIGH_WATER_MARK")

    def test_in_drawdown(self):
        curve = [100.0, 120.0, 90.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=2))
        self.assertEqual(result.structured_value["recoveryState"], "IN_DRAWDOWN")
        self.assertAlmostEqual(result.structured_value["currentDrawdownPct"], (120.0 - 90.0) / 120.0)

    def test_max_drawdown_window(self):
        curve = [100.0, 120.0, 60.0, 130.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=3))
        self.assertAlmostEqual(result.structured_value["maxDrawdownPct"], (120.0 - 60.0) / 120.0)

    def test_recovered_state_and_duration(self):
        curve = [100.0, 120.0, 90.0, 100.0, 125.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=4))
        self.assertEqual(result.structured_value["recoveryState"], "RECOVERED")
        self.assertIsNotNone(result.structured_value["recoveryDurationBars"])

    def test_no_future_equity_only_reads_up_to_as_of_index(self):
        curve = [100.0, 120.0, 90.0, 9999999.0]  # future spike after as_of_index=2
        result_full = drawdown_recovery_result(DrawdownRecoveryInput(curve[:3], as_of_index=2))
        result_with_future = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=2, max_bars_since_last=99))
        self.assertEqual(result_full.structured_value["currentDrawdownPct"], result_with_future.structured_value["currentDrawdownPct"])

    def test_missing_equity_point_is_unknown(self):
        curve = [100.0, None, 90.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=2))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_non_positive_starting_equity_is_invalid(self):
        curve = [0.0, 10.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=1))
        self.assertEqual(result.state, FeatureResultState.INVALID)

    def test_stale_is_stale(self):
        curve = [100.0, 105.0, 110.0, 95.0]
        result = drawdown_recovery_result(DrawdownRecoveryInput(curve, as_of_index=1, max_bars_since_last=1))
        self.assertEqual(result.state, FeatureResultState.STALE)


if __name__ == "__main__":
    unittest.main()
