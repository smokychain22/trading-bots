"""Tests for bots/theta/quant/research/account_risk_capacity.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.account_risk_capacity import (  # noqa: E402
    AccountRiskCapacity,
    AccountRole,
    assert_account_isolation,
    compute_account_qty_cap,
    total_master_and_follower_exposure_never_shared,
)


def _capacity(account_id="acct-1", role=AccountRole.MASTER, **overrides):
    defaults = dict(
        account_id=account_id, account_role=role, equity=100_000.0, collateral_capacity=50_000.0,
        assignment_capacity=1000.0, portfolio_tail_budget=10_000.0, concentration_capacity={"SPY": 20_000.0},
    )
    defaults.update(overrides)
    return AccountRiskCapacity(**defaults)


class ComputeAccountQtyCapTests(unittest.TestCase):
    def test_respects_the_tightest_binding_cap(self):
        capacity = _capacity(collateral_capacity=15_000.0)
        qty = compute_account_qty_cap(
            capacity, required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0, assignment_shares_per_contract=100.0,
        )
        # collateral: 15000/5000=3; assignment: 1000/100=10; tail: 10000/100=100; concentration: 20000/1000=20
        self.assertEqual(qty, 3)

    def test_zero_is_a_legitimate_result_never_floored_to_one(self):
        capacity = _capacity(collateral_capacity=0.0)
        qty = compute_account_qty_cap(
            capacity, required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0, assignment_shares_per_contract=100.0,
        )
        self.assertEqual(qty, 0)

    def test_unknown_collateral_capacity_is_non_executable_zero(self):
        capacity = _capacity(collateral_capacity=None)
        qty = compute_account_qty_cap(
            capacity, required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0, assignment_shares_per_contract=100.0,
        )
        self.assertEqual(qty, 0)

    def test_unknown_concentration_key_is_zero_never_assumed_unlimited(self):
        capacity = _capacity(concentration_capacity={"QQQ": 20_000.0})  # SPY not present
        qty = compute_account_qty_cap(
            capacity, required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0, assignment_shares_per_contract=100.0,
        )
        self.assertEqual(qty, 0)

    def test_custom_cap_can_further_restrict_quantity(self):
        capacity = _capacity(custom_cap=1.0)
        qty = compute_account_qty_cap(
            capacity, required_collateral_per_contract=5_000.0, stress_loss_per_contract=100.0,
            concentration_key="SPY", exposure_per_contract=1_000.0, assignment_shares_per_contract=100.0,
        )
        self.assertEqual(qty, 1)


class AccountIsolationTests(unittest.TestCase):
    def test_correctly_keyed_distinct_accounts_have_no_violations(self):
        capacities = {
            "master-1": _capacity("master-1", AccountRole.MASTER),
            "follower-1": _capacity("follower-1", AccountRole.FOLLOWER, concentration_capacity={"SPY": 5_000.0}),
        }
        self.assertEqual(assert_account_isolation(capacities), [])

    def test_a_mismatched_key_is_flagged(self):
        capacities = {"master-1": _capacity("wrong-id", AccountRole.MASTER)}
        violations = assert_account_isolation(capacities)
        self.assertTrue(any("wrong-id" in v for v in violations))

    def test_two_accounts_sharing_the_identical_capacity_object_is_flagged(self):
        shared = _capacity("master-1", AccountRole.MASTER)
        capacities = {"master-1": shared, "follower-1": shared}
        violations = assert_account_isolation(capacities)
        self.assertTrue(any("share the identical capacity object" in v for v in violations))

    def test_master_and_follower_concentration_dicts_must_not_be_the_same_object(self):
        master = _capacity("master-1", AccountRole.MASTER)
        follower_shared_dict = _capacity("follower-1", AccountRole.FOLLOWER, concentration_capacity=master.concentration_capacity)
        self.assertFalse(total_master_and_follower_exposure_never_shared(master, follower_shared_dict))

        follower_own_dict = _capacity("follower-2", AccountRole.FOLLOWER, concentration_capacity={"SPY": 1_000.0})
        self.assertTrue(total_master_and_follower_exposure_never_shared(master, follower_own_dict))


if __name__ == "__main__":
    unittest.main()
