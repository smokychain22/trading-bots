"""Tests for bots/theta/quant/research/profit_preservation_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.profit_preservation_research import (  # noqa: E402
    ContinuationValueBlocker,
    ProfitCaptureEvidenceState,
    ProfitCaptureState,
    RemainingRewardState,
    compute_profit_capture,
    compute_remaining_reward,
    continuation_value_requirements,
)


class ProfitCaptureTests(unittest.TestCase):
    def test_known_case_computes_ratios_and_giveback(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=150.0, peak_unrealized_pnl=250.0, max_favorable_credit_or_debit=500.0,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.KNOWN)
        self.assertAlmostEqual(result.profit_capture_ratio, 0.30)
        self.assertAlmostEqual(result.peak_capture_ratio, 0.50)
        self.assertAlmostEqual(result.profit_giveback, 100.0)
        self.assertAlmostEqual(result.giveback_ratio, 0.40)

    def test_no_giveback_when_current_equals_peak(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=300.0, peak_unrealized_pnl=300.0, max_favorable_credit_or_debit=500.0,
        ))
        self.assertEqual(result.profit_giveback, 0.0)
        self.assertEqual(result.giveback_ratio, 0.0)

    def test_giveback_ratio_unknown_when_peak_never_positive(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=-50.0, peak_unrealized_pnl=-10.0, max_favorable_credit_or_debit=500.0,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.KNOWN)
        self.assertIsNone(result.giveback_ratio)  # UNKNOWN denominator, never coerced to 0

    def test_missing_input_is_unknown_not_zero(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=None, peak_unrealized_pnl=100.0, max_favorable_credit_or_debit=500.0,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.UNKNOWN)
        self.assertIsNone(result.profit_giveback)

    def test_peak_below_current_is_invalid(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=200.0, peak_unrealized_pnl=100.0, max_favorable_credit_or_debit=500.0,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.INVALID)
        self.assertEqual(result.reason, "PEAK_BELOW_CURRENT_IMPOSSIBLE")

    def test_non_positive_ceiling_is_unknown(self):
        result = compute_profit_capture(ProfitCaptureState(
            current_unrealized_pnl=10.0, peak_unrealized_pnl=10.0, max_favorable_credit_or_debit=0.0,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.UNKNOWN)


class RemainingRewardTests(unittest.TestCase):
    def test_known_case_computes_remaining_reward_and_per_capital_day(self):
        result = compute_remaining_reward(RemainingRewardState(
            max_favorable_credit_or_debit=500.0, current_unrealized_pnl=150.0,
            remaining_capital_days=10.0, downside_tail_estimate=None,
        ))
        self.assertEqual(result.remaining_reward, 350.0)
        self.assertAlmostEqual(result.remaining_reward_per_capital_day, 35.0)
        self.assertIsNone(result.remaining_reward_to_risk)
        self.assertEqual(result.reason, "MODEL_REQUIRED:downside_tail_estimate")

    def test_reward_to_risk_computed_when_tail_estimate_supplied(self):
        result = compute_remaining_reward(RemainingRewardState(
            max_favorable_credit_or_debit=500.0, current_unrealized_pnl=150.0,
            remaining_capital_days=10.0, downside_tail_estimate=175.0,
        ))
        self.assertAlmostEqual(result.remaining_reward_to_risk, 2.0)
        self.assertIsNone(result.reason)

    def test_missing_ceiling_is_unknown(self):
        result = compute_remaining_reward(RemainingRewardState(
            max_favorable_credit_or_debit=None, current_unrealized_pnl=150.0,
            remaining_capital_days=10.0, downside_tail_estimate=None,
        ))
        self.assertEqual(result.state, ProfitCaptureEvidenceState.UNKNOWN)

    def test_per_capital_day_none_without_capital_days(self):
        result = compute_remaining_reward(RemainingRewardState(
            max_favorable_credit_or_debit=500.0, current_unrealized_pnl=150.0,
            remaining_capital_days=None, downside_tail_estimate=None,
        ))
        self.assertIsNone(result.remaining_reward_per_capital_day)


class ContinuationValueRequirementsTests(unittest.TestCase):
    def test_never_fabricates_a_number_only_names_the_blocker(self):
        result = continuation_value_requirements()
        self.assertEqual(result.hold_continuation_value_blocker, ContinuationValueBlocker.FORWARD_EV_MODEL_REQUIRED)
        self.assertEqual(result.close_and_redeploy_value_blocker, ContinuationValueBlocker.REDEPLOY_OPPORTUNITY_SET_REQUIRED)
        self.assertNotIsInstance(result.hold_continuation_value_blocker, float)


if __name__ == "__main__":
    unittest.main()
