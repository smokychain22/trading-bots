"""Tests for bots/theta/quant/features/liquidity.py (work package 11)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.liquidity import LiquidityObservation, liquidity_result  # noqa: E402


def _obs(**overrides) -> LiquidityObservation:
    base = dict(
        option_symbol="SPY261016P00650000", bid=2.0, ask=2.1, volume=100, open_interest=1000,
        quote_age_seconds=5.0, max_quote_age_seconds=60.0,
    )
    base.update(overrides)
    return LiquidityObservation(**base)


class TestLiquidityResult(unittest.TestCase):
    def test_tight_quote_is_ok(self):
        result = liquidity_result(_obs(bid=2.00, ask=2.02))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertAlmostEqual(result.structured_value["spreadAbsolute"], 0.02, places=6)

    def test_wide_quote_is_ok_but_reports_wide_spread(self):
        result = liquidity_result(_obs(bid=1.0, ask=3.0))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertGreater(result.structured_value["spreadPct"], 0.5)

    def test_zero_bid_is_invalid(self):
        result = liquidity_result(_obs(bid=0.0, ask=0.0))
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIsNone(result.structured_value)

    def test_crossed_quote_is_invalid(self):
        result = liquidity_result(_obs(bid=2.5, ask=2.0))
        self.assertEqual(result.state, FeatureResultState.INVALID)

    def test_stale_quote_is_stale(self):
        result = liquidity_result(_obs(quote_age_seconds=120.0, max_quote_age_seconds=60.0))
        self.assertEqual(result.state, FeatureResultState.STALE)
        self.assertIsNone(result.structured_value)

    def test_missing_oi_never_fabricated(self):
        result = liquidity_result(_obs(open_interest=None))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertIsNone(result.structured_value["openInterest"])

    def test_missing_bid_or_ask_is_unknown(self):
        result = liquidity_result(_obs(bid=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_no_depth_never_invented(self):
        result = liquidity_result(_obs())
        self.assertFalse(result.structured_value["depthAvailable"])
        self.assertNotIn("bidSize", result.structured_value)

    def test_depth_present_when_supplied(self):
        result = liquidity_result(_obs(bid_size=10, ask_size=12))
        self.assertTrue(result.structured_value["depthAvailable"])
        self.assertEqual(result.structured_value["bidSize"], 10)


if __name__ == "__main__":
    unittest.main()
