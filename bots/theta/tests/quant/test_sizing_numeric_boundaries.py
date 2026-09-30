"""Malformed sizing policy cannot silently clamp, expand, or coerce quantity."""
import unittest
from dataclasses import replace
from test_sizing import _inputs, _policy
from models.sizing import compute_sizing


CAPS = ("risk_budget_qty_cap", "collateral_qty_cap", "concentration_qty_cap", "assignment_capacity_qty_cap",
        "tail_risk_qty_cap", "correlation_qty_cap", "liquidity_qty_cap")


class SizingNumericBoundaryTests(unittest.TestCase):
    def test_every_cap_is_a_safe_nonnegative_integer(self):
        for field in CAPS:
            for value in (None, True, -1, 1.5, float("nan"), float("inf"), "2", 9007199254740992):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    compute_sizing(replace(_policy(), **{field: value}), _inputs())
        for value in (None, True, -1, 1.5, float("nan"), float("inf"), "2"):
            with self.subTest(broker=value), self.assertRaises(ValueError):
                compute_sizing(_policy(), _inputs(broker_allowed_qty=value))

    def test_cap_reduction_never_increases_quantity_and_zero_is_binding(self):
        for field in CAPS:
            quantities = [compute_sizing(replace(_policy(), **{field: cap}), _inputs()).quantity for cap in range(11)]
            self.assertEqual(quantities, sorted(quantities))
            self.assertEqual(quantities[0], 0)
            for cap, quantity in enumerate(quantities):
                self.assertLessEqual(quantity, cap)

    def test_reduced_multiplier_cannot_expand_quantity_or_coerce_unknown(self):
        for value in (None, True, -0.1, 1.01, float("nan"), float("inf"), "0.5"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                compute_sizing(_policy(reduced_state_multiplier=value), _inputs())

    def test_account_numbers_cannot_be_nonfinite_or_boolean(self):
        for field in ("equity", "cash", "buying_power", "required_collateral_per_contract"):
            for value in (True, "100", float("nan"), float("inf")):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    compute_sizing(_policy(), replace(_inputs(), **{field: value}))

    def test_finite_affordability_overflow_is_an_explicit_invalid_request(self):
        with self.assertRaisesRegex(ValueError, "affordability overflow"):
            compute_sizing(_policy(), _inputs(buying_power=1e308, required_collateral_per_contract=1e-308))


if __name__ == '__main__':
    unittest.main()
