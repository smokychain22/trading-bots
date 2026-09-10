"""Tests for bots/theta/quant/models/theta_q_baseline.py.

All candidate data in this file is explicitly synthetic -- no real market
data, no real underlying names beyond a placeholder symbol.

Run with (from the repo root, once a Python toolchain is set up):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from dataclasses import replace
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.theta_q_baseline import (  # noqa: E402
    BaselinePolicy,
    CostAssumptions,
    CspCandidateInputs,
    SizingPolicy,
    rank_candidates,
)


def _sizing_policy(**overrides) -> SizingPolicy:
    defaults = dict(
        risk_limit_version="TEST-RLV-1",
        max_spread_pct=0.10,
        min_quote_freshness_seconds=5.0,
        min_open_interest=50,
        min_volume=10,
        earnings_exclusion_days=5,
        ownership_acceptability_floor=0.5,
        exceptional_utility_threshold=0.9,
        strong_utility_threshold=0.7,
        minimum_positive_edge=0.05,
        risk_budget_qty_cap=5,
        collateral_qty_cap=3,
        concentration_qty_cap=10,
    )
    defaults.update(overrides)
    return SizingPolicy(**defaults)


def _cost_assumptions(**overrides) -> CostAssumptions:
    defaults = dict(
        commission_per_contract=0.65,
        fees_per_contract=0.05,
        est_slippage_per_contract=1.0,
        cost_model_version="TEST-COST-1",
    )
    defaults.update(overrides)
    return CostAssumptions(**defaults)


def _clean_candidate(**overrides) -> CspCandidateInputs:
    """A fully clean, feasible synthetic candidate. Tests override only the
    field(s) they care about."""
    defaults = dict(
        underlying_symbol="SYN",
        strike=50.0,
        multiplier=100.0,
        entry_premium_per_share=1.50,
        dte=35,
        spread_pct=0.03,
        quote_age_seconds=1.0,
        open_interest=500,
        volume=100,
        earnings_distance_days=40,
        ownership_acceptability=0.8,
        p_severe_drawdown=0.1,
        iv_rank=0.4,
        broker_allowed_qty=4,
        contract_is_standard=True,
    )
    defaults.update(overrides)
    return CspCandidateInputs(**defaults)


class HardVetoTests(unittest.TestCase):
    def setUp(self):
        self.policy = BaselinePolicy(_sizing_policy(), _cost_assumptions())

    def test_clean_candidate_has_no_hard_veto(self):
        result = self.policy.evaluate(_clean_candidate())
        self.assertFalse(result.hard_veto)

    def test_wide_spread_is_hard_vetoed(self):
        result = self.policy.evaluate(_clean_candidate(spread_pct=0.50))
        self.assertTrue(result.hard_veto)
        self.assertIn("SPREAD_TOO_WIDE", [r.code for r in result.reasons])
        self.assertEqual(result.quantity, 0)

    def test_unknown_spread_is_hard_vetoed_not_assumed_acceptable(self):
        result = self.policy.evaluate(_clean_candidate(spread_pct=None))
        self.assertTrue(result.hard_veto)
        self.assertIn("SPREAD_UNKNOWN", [r.code for r in result.reasons])

    def test_stale_quote_is_hard_vetoed(self):
        result = self.policy.evaluate(_clean_candidate(quote_age_seconds=999.0))
        self.assertTrue(result.hard_veto)
        self.assertIn("QUOTE_STALE", [r.code for r in result.reasons])

    def test_near_term_earnings_is_hard_vetoed_in_baseline(self):
        result = self.policy.evaluate(_clean_candidate(earnings_distance_days=2))
        self.assertTrue(result.hard_veto)
        self.assertIn("EARNINGS_TOO_NEAR", [r.code for r in result.reasons])

    def test_non_standard_contract_is_hard_vetoed(self):
        result = self.policy.evaluate(_clean_candidate(contract_is_standard=False))
        self.assertTrue(result.hard_veto)
        self.assertIn("CONTRACT_NON_STANDARD", [r.code for r in result.reasons])

    def test_zero_broker_qty_is_hard_vetoed(self):
        result = self.policy.evaluate(_clean_candidate(broker_allowed_qty=0))
        self.assertTrue(result.hard_veto)
        self.assertEqual(result.quantity, 0)

    def test_unknown_open_interest_is_distinguished_from_known_below_floor(self):
        # UNKNOWN and known-but-below-floor must never share one reason
        # code -- R6 needs to tell a real liquidity rejection apart from a
        # data-availability gap (see docs/quant/phase6_router/DATA_GAP_REGISTER.md).
        unknown = self.policy.evaluate(_clean_candidate(open_interest=None))
        below_floor = self.policy.evaluate(_clean_candidate(open_interest=1))
        self.assertTrue(unknown.hard_veto)
        self.assertTrue(below_floor.hard_veto)
        self.assertIn("OPEN_INTEREST_UNKNOWN", [r.code for r in unknown.reasons])
        self.assertNotIn("OPEN_INTEREST_BELOW_FLOOR", [r.code for r in unknown.reasons])
        self.assertIn("OPEN_INTEREST_BELOW_FLOOR", [r.code for r in below_floor.reasons])
        self.assertNotIn("OPEN_INTEREST_UNKNOWN", [r.code for r in below_floor.reasons])

    def test_unknown_volume_is_distinguished_from_known_below_floor(self):
        unknown = self.policy.evaluate(_clean_candidate(volume=None))
        below_floor = self.policy.evaluate(_clean_candidate(volume=1))
        self.assertTrue(unknown.hard_veto)
        self.assertTrue(below_floor.hard_veto)
        self.assertIn("VOLUME_UNKNOWN", [r.code for r in unknown.reasons])
        self.assertNotIn("VOLUME_BELOW_FLOOR", [r.code for r in unknown.reasons])
        self.assertIn("VOLUME_BELOW_FLOOR", [r.code for r in below_floor.reasons])
        self.assertNotIn("VOLUME_UNKNOWN", [r.code for r in below_floor.reasons])

    def test_sufficient_known_open_interest_and_volume_are_not_hard_vetoed_on_liquidity(self):
        result = self.policy.evaluate(_clean_candidate(open_interest=500, volume=100))
        codes = [r.code for r in result.reasons]
        self.assertNotIn("OPEN_INTEREST_UNKNOWN", codes)
        self.assertNotIn("OPEN_INTEREST_BELOW_FLOOR", codes)
        self.assertNotIn("VOLUME_UNKNOWN", codes)
        self.assertNotIn("VOLUME_BELOW_FLOOR", codes)


class OwnershipScoringTests(unittest.TestCase):
    def setUp(self):
        self.policy = BaselinePolicy(_sizing_policy(), _cost_assumptions())

    def test_ownership_score_is_transparent_product(self):
        result = self.policy.evaluate(_clean_candidate(ownership_acceptability=0.8, p_severe_drawdown=0.1))
        # 0.8 * (1 - 0.1) = 0.72, hand-computed
        self.assertAlmostEqual(result.ownership_score, 0.72, places=10)

    def test_unknown_ownership_yields_none_not_a_default(self):
        result = self.policy.evaluate(_clean_candidate(ownership_acceptability=None))
        self.assertIsNone(result.ownership_score)
        self.assertEqual(result.quantity, 0)
        self.assertIn("OWNERSHIP_ACCEPTABILITY_UNKNOWN", [r.code for r in result.reasons])

    def test_unknown_severe_drawdown_yields_none_not_a_default(self):
        result = self.policy.evaluate(_clean_candidate(p_severe_drawdown=None))
        self.assertIsNone(result.ownership_score)
        self.assertIn("SEVERE_DRAWDOWN_PROB_UNKNOWN", [r.code for r in result.reasons])

    def test_below_floor_ownership_zeroes_quantity_but_is_not_a_hard_veto(self):
        result = self.policy.evaluate(
            _clean_candidate(ownership_acceptability=0.2, p_severe_drawdown=0.1)
        )
        self.assertFalse(result.hard_veto)  # soft rejection, not hard
        self.assertEqual(result.quantity, 0)
        self.assertIn("OWNERSHIP_BELOW_FLOOR", [r.code for r in result.reasons])

    def test_iv_rank_is_informational_never_a_gate(self):
        low_iv = self.policy.evaluate(_clean_candidate(iv_rank=0.05))
        high_iv = self.policy.evaluate(_clean_candidate(iv_rank=0.95))
        # Same ownership/drawdown inputs -> identical score and quantity
        # regardless of iv_rank, proving iv_rank never gates by itself
        # (TRD UNIV-002).
        self.assertEqual(low_iv.ownership_score, high_iv.ownership_score)
        self.assertEqual(low_iv.quantity, high_iv.quantity)


class EconomicsTests(unittest.TestCase):
    def setUp(self):
        self.policy = BaselinePolicy(_sizing_policy(), _cost_assumptions())

    def test_economics_formulas_match_hand_computed_values(self):
        result = self.policy.evaluate(
            _clean_candidate(strike=50.0, multiplier=100.0, entry_premium_per_share=1.50)
        )
        econ = result.economics
        self.assertAlmostEqual(econ.max_profit, 150.0, places=10)
        self.assertAlmostEqual(econ.break_even_price, 48.5, places=10)
        self.assertAlmostEqual(econ.secured_collateral_per_contract, 5000.0, places=10)
        self.assertAlmostEqual(econ.credit_collateral_ratio, 0.03, places=10)

    def test_ev_net_is_never_fabricated(self):
        result = self.policy.evaluate(_clean_candidate())
        self.assertIsNone(result.economics.ev_net)
        self.assertIsNotNone(result.economics.ev_net_unknown_reason)
        self.assertIn("calibrated entry-outcome", result.economics.ev_net_unknown_reason)


class SizingTests(unittest.TestCase):
    def test_quantity_respects_the_tightest_cap(self):
        policy = BaselinePolicy(
            _sizing_policy(risk_budget_qty_cap=5, collateral_qty_cap=3, concentration_qty_cap=10),
            _cost_assumptions(),
        )
        result = policy.evaluate(_clean_candidate(broker_allowed_qty=4))
        # min(5, 3, 10, 4) = 3
        self.assertEqual(result.quantity, 3)

    def test_quantity_zero_is_reachable_and_never_floored_to_one(self):
        policy = BaselinePolicy(
            _sizing_policy(risk_budget_qty_cap=0),
            _cost_assumptions(),
        )
        result = policy.evaluate(_clean_candidate())
        self.assertFalse(result.hard_veto)
        self.assertIsNotNone(result.ownership_score)  # ownership was fine
        self.assertEqual(result.quantity, 0)  # but the cap zeroed it -- no max(1, qty) anywhere


class RankCandidatesTests(unittest.TestCase):
    def setUp(self):
        self.policy = BaselinePolicy(_sizing_policy(), _cost_assumptions())

    def test_feasible_candidates_ranked_by_ownership_score_descending(self):
        strong = _clean_candidate(underlying_symbol="STRONG", ownership_acceptability=0.9, p_severe_drawdown=0.05)
        weak = _clean_candidate(underlying_symbol="WEAK", ownership_acceptability=0.6, p_severe_drawdown=0.2)
        ranked = rank_candidates(self.policy, [weak, strong])
        self.assertEqual([r.underlying_symbol for r in ranked[:2]], ["STRONG", "WEAK"])

    def test_infeasible_candidates_are_retained_not_dropped(self):
        feasible = _clean_candidate(underlying_symbol="OK")
        vetoed = _clean_candidate(underlying_symbol="VETOED", spread_pct=0.9)
        ranked = rank_candidates(self.policy, [feasible, vetoed])
        symbols = {r.underlying_symbol for r in ranked}
        self.assertEqual(symbols, {"OK", "VETOED"})  # CAND-002: rejected alternatives retained

    def test_empty_candidate_list_returns_empty_list(self):
        self.assertEqual(rank_candidates(self.policy, []), [])


if __name__ == "__main__":
    unittest.main()
