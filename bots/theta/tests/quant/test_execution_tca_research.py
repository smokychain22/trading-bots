"""Tests for research/execution_tca_research.py."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.execution_tca_research import (  # noqa: E402
    FillModel,
    FillQuoteState,
    LegFillEstimate,
    MultiLegFillMode,
    Quote,
    RollExecutionCost,
    TcaCheckpointPrices,
    classify_quote_state,
    compute_roll_execution_cost,
    compute_tca,
    estimate_fill_across_models,
    evaluate_multi_leg_fill,
)


class ClassifyQuoteStateTests(unittest.TestCase):
    def test_normal_quote(self):
        self.assertEqual(classify_quote_state(Quote(bid=1.0, ask=1.1), 0.5), FillQuoteState.NORMAL)

    def test_zero_bid(self):
        self.assertEqual(classify_quote_state(Quote(bid=0.0, ask=0.05), 0.5), FillQuoteState.ZERO_BID)

    def test_wide_market(self):
        self.assertEqual(classify_quote_state(Quote(bid=1.0, ask=3.0), 0.5), FillQuoteState.WIDE_MARKET)

    def test_invalid_quote_bid_exceeds_ask(self):
        self.assertEqual(classify_quote_state(Quote(bid=2.0, ask=1.0), 0.5), FillQuoteState.INVALID_QUOTE)

    def test_invalid_quote_missing_ask(self):
        self.assertEqual(classify_quote_state(Quote(bid=1.0, ask=None), 0.5), FillQuoteState.INVALID_QUOTE)


class EstimateFillAcrossModelsTests(unittest.TestCase):
    def test_wide_market_still_produces_mid_bid_ask_estimates(self):
        estimates = estimate_fill_across_models(Quote(bid=1.0, ask=3.0), "sell", wide_market_spread_to_mid_ratio=0.5)
        by_model = {e.model: e for e in estimates}
        self.assertAlmostEqual(by_model[FillModel.MID].price, 2.0)
        self.assertAlmostEqual(by_model[FillModel.BID_SIDE].price, 1.0)
        self.assertAlmostEqual(by_model[FillModel.ASK_SIDE].price, 3.0)

    def test_zero_bid_sell_yields_no_modeled_fill_for_any_model(self):
        estimates = estimate_fill_across_models(Quote(bid=0.0, ask=0.10), "sell", wide_market_spread_to_mid_ratio=0.5)
        self.assertTrue(all(e.price is None for e in estimates))
        self.assertTrue(all(e.reason == "ZERO_BID_NO_SELL_FILL_MODELED" for e in estimates))

    def test_zero_bid_buy_side_still_estimates_since_only_selling_is_blocked(self):
        estimates = estimate_fill_across_models(Quote(bid=0.0, ask=0.10), "buy", wide_market_spread_to_mid_ratio=0.5)
        by_model = {e.model: e for e in estimates}
        self.assertIsNotNone(by_model[FillModel.MID].price)

    def test_invalid_quote_yields_no_estimates(self):
        estimates = estimate_fill_across_models(Quote(bid=2.0, ask=1.0), "sell", wide_market_spread_to_mid_ratio=0.5)
        self.assertTrue(all(e.price is None and e.reason == "INVALID_QUOTE" for e in estimates))

    def test_missing_optional_inputs_reported_not_silently_skipped(self):
        estimates = estimate_fill_across_models(Quote(bid=1.0, ask=1.2), "sell", wide_market_spread_to_mid_ratio=0.5)
        by_model = {e.model: e for e in estimates}
        self.assertIsNone(by_model[FillModel.SPREAD_FRACTION].price)
        self.assertEqual(by_model[FillModel.SPREAD_FRACTION].reason, "MISSING_SPREAD_FRACTION")
        self.assertIsNone(by_model[FillModel.LIQUIDITY_ADJUSTED].price)
        self.assertIsNone(by_model[FillModel.PER_LEG_SLIPPAGE].price)

    def test_liquidity_adjusted_concession_scales_with_oversize(self):
        estimates = estimate_fill_across_models(
            Quote(bid=1.0, ask=1.2), "sell", wide_market_spread_to_mid_ratio=0.5,
            order_size=200.0, available_liquidity=100.0, liquidity_concession_per_unit_oversize=1.0,
        )
        by_model = {e.model: e for e in estimates}
        liquidity = by_model[FillModel.LIQUIDITY_ADJUSTED].price
        mid = 1.1
        self.assertLess(liquidity, mid)  # a seller facing oversize demand gets a WORSE (lower) modeled price


class MultiLegFillTests(unittest.TestCase):
    def test_simultaneous_package_nets_legs_by_sign(self):
        legs = [LegFillEstimate("short_call", 2.0), LegFillEstimate("long_call", 0.5)]
        result = evaluate_multi_leg_fill(MultiLegFillMode.SIMULTANEOUS_PACKAGE, legs, leg_signs=[-1.0, 1.0])
        self.assertAlmostEqual(result.net_price, -1.5)
        self.assertIsNone(result.legging_exposure_seconds)

    def test_missing_leg_fill_yields_no_net_price(self):
        legs = [LegFillEstimate("short_call", None), LegFillEstimate("long_call", 0.5)]
        result = evaluate_multi_leg_fill(MultiLegFillMode.SIMULTANEOUS_PACKAGE, legs, leg_signs=[-1.0, 1.0])
        self.assertIsNone(result.net_price)
        self.assertEqual(result.reason, "AT_LEAST_ONE_LEG_HAS_NO_MODELED_FILL")

    def test_independent_legging_requires_gap_seconds(self):
        legs = [LegFillEstimate("short_call", 2.0), LegFillEstimate("long_call", 0.5)]
        result = evaluate_multi_leg_fill(MultiLegFillMode.INDEPENDENT_LEGGING, legs, leg_signs=[-1.0, 1.0])
        self.assertIsNotNone(result.net_price)
        self.assertIsNone(result.legging_exposure_seconds)
        self.assertEqual(result.reason, "MISSING_LEGGING_GAP_SECONDS")

    def test_independent_legging_with_gap_reports_exposure(self):
        legs = [LegFillEstimate("short_call", 2.0), LegFillEstimate("long_call", 0.5)]
        result = evaluate_multi_leg_fill(MultiLegFillMode.INDEPENDENT_LEGGING, legs, leg_signs=[-1.0, 1.0], independent_legging_gap_seconds=45.0)
        self.assertEqual(result.legging_exposure_seconds, 45.0)


class ComputeTcaTests(unittest.TestCase):
    def test_sell_side_slippage_vs_mid(self):
        prices = TcaCheckpointPrices(decision_mid=2.0, arrival_bid=1.8, arrival_ask=2.0, submitted_limit=1.9, fill_price=1.85, side="sell")
        result = compute_tca(prices)
        self.assertAlmostEqual(result.slippage_vs_decision_mid, 0.15)

    def test_buy_side_slippage_sign_flips(self):
        prices = TcaCheckpointPrices(decision_mid=2.0, arrival_bid=1.9, arrival_ask=2.1, submitted_limit=2.05, fill_price=2.15, side="buy")
        result = compute_tca(prices)
        self.assertAlmostEqual(result.slippage_vs_decision_mid, 0.15)

    def test_missing_operand_yields_none(self):
        prices = TcaCheckpointPrices(decision_mid=None, arrival_bid=1.8, arrival_ask=2.0, submitted_limit=1.9, fill_price=1.85, side="sell")
        result = compute_tca(prices)
        self.assertIsNone(result.slippage_vs_decision_mid)

    def test_spread_capture_positive_when_filled_better_than_arrival_mid(self):
        prices = TcaCheckpointPrices(decision_mid=2.0, arrival_bid=1.8, arrival_ask=2.0, submitted_limit=1.95, fill_price=1.95, side="sell")
        result = compute_tca(prices)
        self.assertGreater(result.spread_capture_or_concession, 0.0)


class RollExecutionCostTests(unittest.TestCase):
    def test_net_cost_is_additive(self):
        result = compute_roll_execution_cost(close_leg_cost=0.10, open_leg_cost=0.05)
        self.assertAlmostEqual(result.net_roll_execution_cost, 0.15)

    def test_missing_leg_cost_yields_no_net(self):
        result = compute_roll_execution_cost(close_leg_cost=None, open_leg_cost=0.05)
        self.assertIsNone(result.net_roll_execution_cost)


if __name__ == "__main__":
    unittest.main()
