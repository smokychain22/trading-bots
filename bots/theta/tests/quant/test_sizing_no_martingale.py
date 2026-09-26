"""Adversarial no-martingale tests for bots/theta/quant/models/sizing.py.

Phase 4 (Profitability Brain Completion Program) 4I. Synthetic data only --
these tests prove a structural property of compute_sizing(), not a claim
about real trading outcomes.
"""

import dataclasses
import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import RiskState  # noqa: E402
from models.sizing import SizingInputs, SizingPolicy, compute_sizing  # noqa: E402


def _policy(**overrides) -> SizingPolicy:
    defaults = dict(
        policy_version="TEST-SIZING-NO-MARTINGALE-1",
        risk_budget_qty_cap=5,
        collateral_qty_cap=10,
        concentration_qty_cap=10,
        assignment_capacity_qty_cap=10,
        tail_risk_qty_cap=10,
        correlation_qty_cap=10,
        liquidity_qty_cap=10,
        reduced_state_multiplier=0.5,
    )
    defaults.update(overrides)
    return SizingPolicy(**defaults)


def _inputs(**overrides) -> SizingInputs:
    defaults = dict(
        equity=50000.0, cash=50000.0, buying_power=50000.0,
        required_collateral_per_contract=5000.0, broker_allowed_qty=10,
        risk_state=RiskState.ALLOW_FULL,
    )
    defaults.update(overrides)
    return SizingInputs(**defaults)


class NoMartingaleTests(unittest.TestCase):
    def test_sizing_inputs_has_no_loss_history_field(self):
        """CORE CLAIM: SizingPolicy/SizingInputs carry no field through which
        a caller could pass recent-loss, streak, or PnL-conditioned scaling --
        the sizing module's own docstring claims this; verify it structurally
        rather than trusting the comment."""
        forbidden_substrings = ("loss", "streak", "pnl", "consecutive", "revenge", "recent_")
        for cls in (SizingPolicy, SizingInputs):
            for field in dataclasses.fields(cls):
                lowered = field.name.lower()
                for token in forbidden_substrings:
                    self.assertNotIn(
                        token, lowered,
                        f"{cls.__name__}.{field.name} looks loss-conditioned -- "
                        "no-martingale invariant would be violated if this field "
                        "existed and were consumed by compute_sizing().",
                    )

    def test_identical_inputs_produce_identical_quantity_regardless_of_call_order(self):
        """Repeated calls with the same real inputs never drift upward --
        deterministic, not path-dependent on how many times it was called."""
        policy = _policy()
        inputs = _inputs()
        results = [compute_sizing(policy, inputs).quantity for _ in range(5)]
        self.assertEqual(len(set(results)), 1)

    def test_reduced_state_multiplier_is_fixed_not_escalating(self):
        """ALLOW_REDUCED always applies the same configured multiplier --
        it never compounds or escalates across repeated evaluations."""
        policy = _policy(reduced_state_multiplier=0.5)
        inputs = _inputs(risk_state=RiskState.ALLOW_REDUCED)
        first = compute_sizing(policy, inputs).quantity
        second = compute_sizing(policy, inputs).quantity
        third = compute_sizing(policy, inputs).quantity
        self.assertEqual(first, second)
        self.assertEqual(second, third)

    def test_a_tighter_policy_after_a_hypothetical_loss_only_reduces_or_holds_quantity(self):
        """A caller cannot smuggle loss-conditioned scaling in by tightening
        a cap after a loss -- tightening any cap can only reduce or hold
        quantity, never increase it (the min() over caps is monotonic)."""
        loose_policy = _policy(risk_budget_qty_cap=8)
        tight_policy = _policy(risk_budget_qty_cap=2)
        inputs = _inputs()
        loose_qty = compute_sizing(loose_policy, inputs).quantity
        tight_qty = compute_sizing(tight_policy, inputs).quantity
        self.assertLessEqual(tight_qty, loose_qty)

    def test_quantity_zero_is_reachable_and_never_floored_to_one(self):
        """A losing/degraded state (AEGIS HOLD_ONLY) sizes to zero, never
        max(1, qty) -- the module's own stated invariant, verified."""
        policy = _policy()
        inputs = _inputs(risk_state=RiskState.HOLD_ONLY)
        result = compute_sizing(policy, inputs)
        self.assertEqual(result.quantity, 0)
        self.assertNotEqual(result.quantity, 1)


if __name__ == "__main__":
    unittest.main()
