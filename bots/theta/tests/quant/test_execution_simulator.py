"""Tests for bots/theta/quant/research/execution_simulator.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.execution_simulator import (  # noqa: E402
    FillOutcome,
    FillProbability,
    OrderRequest,
    OrderSide,
    QuoteState,
    is_buy_side,
    simulate_fill,
)


def _quote(**overrides):
    defaults = dict(bid=1.00, ask=1.10, bid_size=50.0, ask_size=50.0, quote_age_seconds=1.0, session_open=True)
    defaults.update(overrides)
    return QuoteState(**defaults)


def _request(side, **overrides):
    defaults = dict(side=side, quantity=10.0, limit_price=None, max_quote_age_seconds=30.0)
    defaults.update(overrides)
    return OrderRequest(**defaults)


class DirectionAwarenessTests(unittest.TestCase):
    def test_buy_side_classification(self):
        self.assertTrue(is_buy_side(OrderSide.BUY_TO_OPEN))
        self.assertTrue(is_buy_side(OrderSide.BUY_TO_CLOSE))
        self.assertTrue(is_buy_side(OrderSide.BUY_STOCK))
        self.assertFalse(is_buy_side(OrderSide.SELL_TO_OPEN))
        self.assertFalse(is_buy_side(OrderSide.SELL_TO_CLOSE))
        self.assertFalse(is_buy_side(OrderSide.SELL_STOCK))

    def test_a_buy_fills_above_mid_toward_the_ask(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=0.75)
        mid = 1.05
        self.assertGreater(result.fill_price, mid)

    def test_a_sell_fills_below_mid_toward_the_bid(self):
        result = simulate_fill(_request(OrderSide.SELL_TO_OPEN), _quote(), fill_ratio=0.75)
        mid = 1.05
        self.assertLess(result.fill_price, mid)

    def test_a_zero_fill_ratio_lands_exactly_at_the_passive_side_never_at_the_midpoint(self):
        # Regression test for the midpoint-anchoring bug: fill_ratio=0.0
        # must land at the bid for a buy / the ask for a sell (the
        # passive, best-for-the-trader side), never at the midpoint.
        buy_result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=0.0)
        self.assertAlmostEqual(buy_result.fill_price, 1.00)  # the bid
        sell_result = simulate_fill(_request(OrderSide.SELL_TO_OPEN), _quote(), fill_ratio=0.0)
        self.assertAlmostEqual(sell_result.fill_price, 1.10)  # the ask

    def test_a_half_fill_ratio_spans_the_full_spread_to_exactly_the_midpoint(self):
        # fill_ratio must span the FULL bid-ask range, not half of it --
        # 0.5 lands exactly at the midpoint for both directions.
        buy_result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=0.5)
        self.assertAlmostEqual(buy_result.fill_price, 1.05)
        sell_result = simulate_fill(_request(OrderSide.SELL_TO_OPEN), _quote(), fill_ratio=0.5)
        self.assertAlmostEqual(sell_result.fill_price, 1.05)

    def test_buying_and_selling_the_same_quote_never_produce_the_same_fill_price(self):
        # fill_ratio=0.5 lands both directions exactly at the midpoint by
        # construction (a real, correct coincidence, not a bug) -- use a
        # ratio off the midpoint to prove buy and sell diverge in
        # opposite directions from the same quote.
        buy_result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=0.75)
        sell_result = simulate_fill(_request(OrderSide.SELL_TO_OPEN), _quote(), fill_ratio=0.75)
        self.assertNotEqual(buy_result.fill_price, sell_result.fill_price)

    def test_a_full_spread_fill_ratio_lands_exactly_at_the_relevant_quote_side(self):
        buy_result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=1.0)
        self.assertAlmostEqual(buy_result.fill_price, 1.10)  # the ask
        sell_result = simulate_fill(_request(OrderSide.SELL_TO_OPEN), _quote(), fill_ratio=1.0)
        self.assertAlmostEqual(sell_result.fill_price, 1.00)  # the bid


class FillEligibilityTests(unittest.TestCase):
    def test_a_full_fill_when_quoted_size_covers_the_full_request(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN, quantity=10.0), _quote(ask_size=50.0), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.FULL_FILL)
        self.assertEqual(result.filled_quantity, 10.0)
        self.assertEqual(result.unfilled_quantity, 0.0)

    def test_a_partial_fill_when_the_request_exceeds_quoted_size(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN, quantity=100.0), _quote(ask_size=30.0), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.PARTIAL_FILL)
        self.assertEqual(result.filled_quantity, 30.0)
        self.assertEqual(result.unfilled_quantity, 70.0)

    def test_zero_quoted_size_is_no_fill_never_assumed_sufficient(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(ask_size=0.0), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.NO_FILL)

    def test_unknown_quoted_size_is_treated_as_zero_liquidity_never_assumed_sufficient(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(ask_size=None), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.NO_FILL)

    def test_a_buy_limit_below_the_modeled_fill_price_produces_no_fill(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN, limit_price=1.01), _quote(), fill_ratio=1.0)  # would fill at 1.10
        self.assertEqual(result.outcome, FillOutcome.NO_FILL)

    def test_a_sell_limit_above_the_modeled_fill_price_produces_no_fill(self):
        result = simulate_fill(_request(OrderSide.SELL_TO_OPEN, limit_price=1.09), _quote(), fill_ratio=1.0)  # would fill at 1.00
        self.assertEqual(result.outcome, FillOutcome.NO_FILL)

    def test_a_marketable_limit_fills_normally(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN, limit_price=1.10), _quote(), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.FULL_FILL)


class StaleAndInvalidQuoteTests(unittest.TestCase):
    def test_a_stale_quote_is_rejected_never_filled(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN, max_quote_age_seconds=5.0), _quote(quote_age_seconds=100.0), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.REJECTED_STALE_QUOTE)

    def test_an_unknown_quote_age_is_rejected_never_assumed_fresh(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(quote_age_seconds=None), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.REJECTED_STALE_QUOTE)

    def test_a_crossed_market_is_rejected_as_invalid(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(bid=1.10, ask=1.00), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.REJECTED_INVALID_QUOTE)

    def test_a_missing_bid_or_ask_is_rejected_as_invalid(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(bid=None), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.REJECTED_INVALID_QUOTE)

    def test_a_closed_session_rejects_regardless_of_quote_quality(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(session_open=False), fill_ratio=0.5)
        self.assertEqual(result.outcome, FillOutcome.REJECTED_SESSION_CLOSED)

    def test_invalid_fill_ratio_raises(self):
        with self.assertRaises(ValueError):
            simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(), fill_ratio=1.5)


class FillProbabilityHonestyTests(unittest.TestCase):
    def test_fill_probability_is_always_unknown_never_a_fabricated_percentage(self):
        for side in OrderSide:
            result = simulate_fill(_request(side), _quote(), fill_ratio=0.5)
            self.assertEqual(result.fill_probability, FillProbability.UNKNOWN)

    def test_fill_probability_remains_unknown_even_on_rejection_paths(self):
        result = simulate_fill(_request(OrderSide.BUY_TO_OPEN), _quote(session_open=False), fill_ratio=0.5)
        self.assertEqual(result.fill_probability, FillProbability.UNKNOWN)


class StockOrderTests(unittest.TestCase):
    def test_buy_stock_and_sell_stock_use_the_same_direction_semantics_as_options(self):
        buy_result = simulate_fill(_request(OrderSide.BUY_STOCK), _quote(), fill_ratio=0.75)
        sell_result = simulate_fill(_request(OrderSide.SELL_STOCK), _quote(), fill_ratio=0.75)
        self.assertGreater(buy_result.fill_price, sell_result.fill_price)


if __name__ == "__main__":
    unittest.main()
