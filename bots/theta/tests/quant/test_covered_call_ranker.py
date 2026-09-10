"""Tests for bots/theta/quant/models/covered_call_ranker.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.covered_call_ranker import (  # noqa: E402
    CoveredCallCandidate,
    CoveredCallPolicy,
    StockRetainedContext,
    rank_covered_call_frontier,
)


def _policy(**overrides) -> CoveredCallPolicy:
    defaults = dict(policy_version="TEST-CC-1", execution_cost_per_contract=1.0)
    defaults.update(overrides)
    return CoveredCallPolicy(**defaults)


def _stock(**overrides) -> StockRetainedContext:
    defaults = dict(shares=100.0, economic_basis_per_share=48.0, current_price_per_share=50.0, stock_ev_if_uncapped=None)
    defaults.update(overrides)
    return StockRetainedContext(**defaults)


class WaitDefaultTests(unittest.TestCase):
    def test_wait_selected_when_no_alternative_beats_it(self):
        decision = rank_covered_call_frontier(_policy(), [], _stock(stock_ev_if_uncapped=100.0, current_price_per_share=None))
        self.assertEqual(decision.selected_label, "WAIT")
        self.assertIn("WAIT_SELECTED_AS_DEFAULT", [r.code for r in decision.selected_reasons])

    def test_cc_rejected_despite_positive_premium_when_call_away_regret_dominates(self):
        candidate = CoveredCallCandidate(
            strike=52.0, dte=30, credit_per_share=0.50, multiplier=100.0,
            call_away_regret_per_share=3.0,  # forfeited upside far exceeds the premium collected
            event_risk_penalty=0.0,
        )
        decision = rank_covered_call_frontier(_policy(), [candidate], _stock(stock_ev_if_uncapped=0.0))
        self.assertNotIn("SELL_CC", decision.selected_label)


class SellCcSelectionTests(unittest.TestCase):
    def test_sell_cc_selected_when_genuinely_superior(self):
        candidate = CoveredCallCandidate(
            strike=55.0, dte=30, credit_per_share=1.20, multiplier=100.0,
            call_away_regret_per_share=0.10, event_risk_penalty=0.0,
        )
        decision = rank_covered_call_frontier(
            _policy(), [candidate], _stock(stock_ev_if_uncapped=0.0, current_price_per_share=None)
        )
        self.assertIn("SELL_CC", decision.selected_label)

    def test_unknown_call_away_regret_never_defaults_to_zero_and_never_selected(self):
        candidate = CoveredCallCandidate(
            strike=55.0, dte=30, credit_per_share=1.20, multiplier=100.0,
            call_away_regret_per_share=None, event_risk_penalty=0.0,
        )
        decision = rank_covered_call_frontier(_policy(), [candidate], _stock(stock_ev_if_uncapped=0.0))
        cc_valuation = next(v for v in decision.valuations if v.label.startswith("SELL_CC"))
        self.assertIsNone(cc_valuation.utility)
        self.assertNotIn("SELL_CC", decision.selected_label)


class SellStockTests(unittest.TestCase):
    def test_sell_stock_selected_when_stock_is_the_best_option(self):
        decision = rank_covered_call_frontier(
            _policy(), [], _stock(economic_basis_per_share=40.0, current_price_per_share=60.0, stock_ev_if_uncapped=-100.0)
        )
        self.assertEqual(decision.selected_label, "SELL_STOCK")


if __name__ == "__main__":
    unittest.main()
