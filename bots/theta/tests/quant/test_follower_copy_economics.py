"""Tests for bots/theta/quant/research/follower_copy_economics.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.account_risk_capacity import AccountRiskCapacity, AccountRole  # noqa: E402
from research.follower_copy_economics import (  # noqa: E402
    CopyDecision,
    FollowerSizingInputs,
    assess_copyability,
    compute_follower_quantity,
    compute_price_deterioration,
)


def _follower_capacity(**overrides):
    defaults = dict(
        account_id="follower-1", account_role=AccountRole.FOLLOWER, equity=20_000.0,
        collateral_capacity=10_000.0, assignment_capacity=200.0, portfolio_tail_budget=2_000.0,
        concentration_capacity={"SPY": 5_000.0},
    )
    defaults.update(overrides)
    return AccountRiskCapacity(**defaults)


def _inputs(**overrides):
    defaults = dict(
        follower_capacity=_follower_capacity(), required_collateral_per_contract=5_000.0,
        stress_loss_per_contract=100.0, concentration_key="SPY", exposure_per_contract=1_000.0,
        assignment_shares_per_contract=100.0, master_quantity=5,
    )
    defaults.update(overrides)
    return FollowerSizingInputs(**defaults)


class ComputeFollowerQuantityTests(unittest.TestCase):
    def test_follower_quantity_is_capped_by_its_own_account_capacity(self):
        # collateral cap = 10000/5000 = 2, well below master_quantity=5
        qty = compute_follower_quantity(_inputs())
        self.assertEqual(qty, 2)

    def test_follower_quantity_never_exceeds_master_quantity_even_with_huge_capacity(self):
        capacity = _follower_capacity(collateral_capacity=1_000_000.0, assignment_capacity=100_000.0,
                                       portfolio_tail_budget=1_000_000.0, concentration_capacity={"SPY": 1_000_000.0})
        qty = compute_follower_quantity(_inputs(follower_capacity=capacity, master_quantity=3))
        self.assertEqual(qty, 3)

    def test_zero_capacity_yields_zero_never_a_forced_minimum(self):
        capacity = _follower_capacity(collateral_capacity=0.0)
        qty = compute_follower_quantity(_inputs(follower_capacity=capacity))
        self.assertEqual(qty, 0)


class PriceDeteriorationTests(unittest.TestCase):
    def test_computes_signed_deterioration(self):
        deterioration = compute_price_deterioration(master_fill_price=1.00, follower_actual_fill_price=1.05)
        self.assertAlmostEqual(deterioration, 0.05)

    def test_unknown_inputs_produce_none_never_zero(self):
        self.assertIsNone(compute_price_deterioration(None, 1.05))
        self.assertIsNone(compute_price_deterioration(1.00, None))


class AssessCopyabilityTests(unittest.TestCase):
    def test_full_capacity_and_fresh_quote_and_compatible_branch_is_copy_eligible(self):
        capacity = _follower_capacity(collateral_capacity=1_000_000.0, assignment_capacity=100_000.0,
                                       portfolio_tail_budget=1_000_000.0, concentration_capacity={"SPY": 1_000_000.0})
        assessment = assess_copyability(_inputs(follower_capacity=capacity), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.COPY_ELIGIBLE)

    def test_binding_capacity_below_master_quantity_is_copy_reduced(self):
        assessment = assess_copyability(_inputs(), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.COPY_REDUCED)

    def test_zero_quantity_is_skip(self):
        capacity = _follower_capacity(collateral_capacity=0.0)
        assessment = assess_copyability(_inputs(follower_capacity=capacity), branch_compatible=True, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)
        self.assertTrue(any("ZERO_QUANTITY" in r for r in assessment.reasons))

    def test_incompatible_branch_is_skip_regardless_of_capacity(self):
        assessment = assess_copyability(_inputs(), branch_compatible=False, quote_fresh=True, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_stale_quote_is_skip(self):
        assessment = assess_copyability(_inputs(), branch_compatible=True, quote_fresh=False, account_isolation_violations=[])
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_account_isolation_violation_is_an_unconditional_skip(self):
        assessment = assess_copyability(
            _inputs(), branch_compatible=True, quote_fresh=True,
            account_isolation_violations=["accounts share the identical capacity object"],
        )
        self.assertEqual(assessment.decision, CopyDecision.SKIP)

    def test_every_non_eligible_decision_carries_an_explicit_reason(self):
        assessment = assess_copyability(_inputs(), branch_compatible=False, quote_fresh=True, account_isolation_violations=[])
        self.assertGreater(len(assessment.reasons), 0)


if __name__ == "__main__":
    unittest.main()
