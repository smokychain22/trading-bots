"""Tests for bots/theta/quant/models/execution_quality.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.execution_quality import (  # noqa: E402
    ExecutionQualityInputs,
    ExecutionQualityPolicy,
    PositionIntent,
    assess_execution_quality,
)


def _policy(**overrides) -> ExecutionQualityPolicy:
    defaults = dict(
        policy_version="TEST-EXEC-1",
        max_acceptable_spread_pct=0.10,
        min_quote_size_for_full_confidence=20,
        max_quote_age_seconds=5.0,
        min_after_cost_utility_to_cross=0.0,
    )
    defaults.update(overrides)
    return ExecutionQualityPolicy(**defaults)


def _inputs(**overrides) -> ExecutionQualityInputs:
    defaults = dict(
        position_intent=PositionIntent.BUY_TO_OPEN,
        bid=0.55, ask=0.60, quote_size=50, quote_age_seconds=1.0,
        limit_price=0.58, pre_slippage_expected_utility=10.0,
    )
    defaults.update(overrides)
    return ExecutionQualityInputs(**defaults)


class MidpointNeverExecutableTruthTests(unittest.TestCase):
    def test_buy_concession_measured_against_ask_not_midpoint(self):
        result = assess_execution_quality(_policy(), _inputs(bid=0.57, ask=0.60, limit_price=0.58))
        # Expected slippage is ask - limit, never (mid - limit).
        self.assertAlmostEqual(result.expected_slippage_per_share, 0.02, places=6)

    def test_sell_concession_measured_against_bid_not_midpoint(self):
        result = assess_execution_quality(
            _policy(),
            _inputs(position_intent=PositionIntent.SELL_TO_OPEN, bid=0.55, ask=0.60, limit_price=0.58),
        )
        self.assertAlmostEqual(result.expected_slippage_per_share, 0.03, places=6)

    def test_sell_fill_probability_increases_toward_bid(self):
        passive = assess_execution_quality(
            _policy(),
            _inputs(position_intent=PositionIntent.SELL_TO_CLOSE, bid=0.55, ask=0.60, limit_price=0.60),
        )
        marketable = assess_execution_quality(
            _policy(),
            _inputs(position_intent=PositionIntent.SELL_TO_CLOSE, bid=0.55, ask=0.60, limit_price=0.55),
        )
        self.assertGreater(marketable.fill_probability, passive.fill_probability)

    def test_buy_fill_probability_increases_toward_ask(self):
        passive = assess_execution_quality(
            _policy(),
            _inputs(position_intent=PositionIntent.BUY_TO_CLOSE, bid=0.55, ask=0.60, limit_price=0.55),
        )
        marketable = assess_execution_quality(
            _policy(),
            _inputs(position_intent=PositionIntent.BUY_TO_CLOSE, bid=0.55, ask=0.60, limit_price=0.60),
        )
        self.assertGreater(marketable.fill_probability, passive.fill_probability)


class StaleAndWideSpreadTests(unittest.TestCase):
    def test_stale_quote_skips_the_trade(self):
        result = assess_execution_quality(_policy(max_quote_age_seconds=2.0), _inputs(quote_age_seconds=5.0))
        self.assertEqual(result.recommended_action, "SKIP")
        self.assertFalse(result.acceptable)

    def test_wide_spread_skips_the_trade(self):
        result = assess_execution_quality(_policy(max_acceptable_spread_pct=0.05), _inputs(bid=0.40, ask=0.60))
        self.assertEqual(result.recommended_action, "SKIP")


class EconomicValueGuardTests(unittest.TestCase):
    def test_negative_post_cost_ev_cancels_rather_than_crossing_blindly(self):
        result = assess_execution_quality(
            _policy(min_after_cost_utility_to_cross=5.0),
            _inputs(pre_slippage_expected_utility=1.0, bid=0.55, ask=0.60, limit_price=0.60),
        )
        self.assertEqual(result.recommended_action, "CANCEL")

    def test_positive_after_cost_ev_submits(self):
        result = assess_execution_quality(_policy(), _inputs(pre_slippage_expected_utility=100.0))
        self.assertEqual(result.recommended_action, "SUBMIT")
        self.assertTrue(result.acceptable)


class UnknownInputTests(unittest.TestCase):
    def test_unknown_quote_never_assumed_acceptable(self):
        result = assess_execution_quality(_policy(), _inputs(bid=None, ask=None))
        self.assertIsNone(result.acceptable)
        self.assertEqual(result.recommended_action, "UNKNOWN")

    def test_unknown_quote_age_never_assumed_fresh(self):
        result = assess_execution_quality(_policy(), _inputs(quote_age_seconds=None))
        self.assertIsNone(result.acceptable)
        self.assertEqual(result.recommended_action, "UNKNOWN")


if __name__ == "__main__":
    unittest.main()
