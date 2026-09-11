"""Tests for bots/theta/quant/models/sizing.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from models.aegis import RiskState  # noqa: E402
from models.sizing import SizingInputs, SizingPolicy, compute_sizing  # noqa: E402


def _policy(**overrides) -> SizingPolicy:
    defaults = dict(
        policy_version="TEST-SIZING-1",
        risk_budget_qty_cap=5,
        collateral_qty_cap=10,
        concentration_qty_cap=10,
        assignment_capacity_qty_cap=10,
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


class BasicSizingTests(unittest.TestCase):
    def test_quantity_respects_the_tightest_cap(self):
        result = compute_sizing(_policy(risk_budget_qty_cap=3), _inputs())
        self.assertEqual(result.quantity, 3)
        self.assertEqual(result.binding_constraint, "RISK_BUDGET")

    def test_quantity_never_floored_to_one(self):
        result = compute_sizing(_policy(risk_budget_qty_cap=0), _inputs())
        self.assertEqual(result.quantity, 0)


class AegisGatingTests(unittest.TestCase):
    def test_hold_only_forces_zero_quantity(self):
        result = compute_sizing(_policy(), _inputs(risk_state=RiskState.HOLD_ONLY))
        self.assertEqual(result.quantity, 0)
        self.assertEqual(result.binding_constraint, "AEGIS")

    def test_hard_veto_forces_zero_quantity(self):
        result = compute_sizing(_policy(), _inputs(risk_state=RiskState.HARD_VETO))
        self.assertEqual(result.quantity, 0)

    def test_allow_reduced_scales_down_quantity(self):
        full = compute_sizing(_policy(risk_budget_qty_cap=4), _inputs(risk_state=RiskState.ALLOW_FULL))
        reduced = compute_sizing(_policy(risk_budget_qty_cap=4), _inputs(risk_state=RiskState.ALLOW_REDUCED))
        self.assertLess(reduced.quantity, full.quantity)


class UnknownInputTests(unittest.TestCase):
    def test_unknown_buying_power_never_defaults_to_a_nonzero_quantity(self):
        result = compute_sizing(_policy(), _inputs(buying_power=None))
        self.assertEqual(result.quantity, 0)
        self.assertEqual(result.binding_constraint, "UNKNOWN_INPUT")


class NoMartingaleTests(unittest.TestCase):
    def test_sizing_has_no_input_that_could_scale_up_after_a_loss(self):
        # Structural guard: SizingInputs has no field representing recent
        # losses/streaks at all, so there is no lever through which a
        # caller could implement loss-doubling even by accident.
        import dataclasses
        field_names = {f.name for f in dataclasses.fields(_inputs())}
        self.assertNotIn("recent_losses", field_names)
        self.assertNotIn("loss_streak", field_names)

    def test_identical_inputs_always_produce_identical_quantity(self):
        first = compute_sizing(_policy(), _inputs())
        second = compute_sizing(_policy(), _inputs())
        self.assertEqual(first.quantity, second.quantity)


class CapConsistencyTests(unittest.TestCase):
    """GitHub research finding (docs/research/GITHUB_REPO_RESEARCH_LEDGER.md,
    HasibVortex369/riskkit): a sizer that derives capital_required from a
    SEPARATE risk-fraction representation risks that figure silently going
    stale once a hard cap binds and overrides the fraction-derived quantity.
    THETA's compute_sizing structurally cannot suffer this: capital_required
    is always recomputed directly from the FINAL, already-capped quantity,
    never from an intermediate fractional representation -- there is no
    second number that could drift. These tests pin that invariant down as a
    permanent regression test, not just a documented comparison."""

    def test_capital_required_always_matches_the_final_capped_quantity(self):
        # risk_budget_qty_cap=2 binds well below what buying power/collateral
        # alone would allow (10 contracts) -- capital_required must reflect
        # the CAPPED quantity (2), never the pre-cap affordable quantity.
        result = compute_sizing(_policy(risk_budget_qty_cap=2), _inputs())
        self.assertEqual(result.quantity, 2)
        self.assertEqual(result.capital_required, 2 * 5000.0)

    def test_capital_required_reflects_the_reduced_state_multiplier_too(self):
        # ALLOW_REDUCED scales quantity down AFTER the cap is chosen --
        # capital_required must reflect that final, scaled-down quantity.
        result = compute_sizing(_policy(risk_budget_qty_cap=4), _inputs(risk_state=RiskState.ALLOW_REDUCED))
        self.assertEqual(result.quantity, 2)  # floor(4 * 0.5)
        self.assertEqual(result.capital_required, 2 * 5000.0)
        self.assertEqual(result.binding_constraint, "AEGIS_ALLOW_REDUCED")


class MonotonicityInvariantTests(unittest.TestCase):
    """R6E item 12: Qty = min(collateral_capacity, assignment_capacity,
    expected_shortfall_capacity, concentration_capacity, portfolio_stress_
    capacity) must never let TIGHTENING any one of those capacities
    INCREASE the resulting quantity, and zero capacity on any dimension
    must zero the whole quantity. `risk_budget_qty_cap` is the existing
    stand-in for the tail-risk/ES/portfolio-stress capacity in the current
    `sizing.py` implementation -- there is no separate named field for
    each of those three yet, so this test exercises the cap that exists
    today; a future session that splits them into distinct fields must
    re-verify this same monotonicity property per field."""

    def test_tightening_the_risk_budget_cap_never_increases_quantity(self):
        loose = compute_sizing(_policy(risk_budget_qty_cap=8), _inputs())
        tight = compute_sizing(_policy(risk_budget_qty_cap=3), _inputs())
        self.assertLessEqual(tight.quantity, loose.quantity)

    def test_tightening_the_concentration_cap_never_increases_quantity(self):
        loose = compute_sizing(_policy(concentration_qty_cap=8), _inputs())
        tight = compute_sizing(_policy(concentration_qty_cap=2), _inputs())
        self.assertLessEqual(tight.quantity, loose.quantity)

    def test_tightening_the_assignment_capacity_cap_never_increases_quantity(self):
        loose = compute_sizing(_policy(assignment_capacity_qty_cap=8), _inputs())
        tight = compute_sizing(_policy(assignment_capacity_qty_cap=1), _inputs())
        self.assertLessEqual(tight.quantity, loose.quantity)

    def test_zero_risk_budget_capacity_zeros_the_quantity(self):
        result = compute_sizing(_policy(risk_budget_qty_cap=0), _inputs())
        self.assertEqual(result.quantity, 0)

    def test_zero_concentration_capacity_zeros_the_quantity(self):
        result = compute_sizing(_policy(concentration_qty_cap=0), _inputs())
        self.assertEqual(result.quantity, 0)

    def test_zero_assignment_capacity_zeros_the_quantity(self):
        result = compute_sizing(_policy(assignment_capacity_qty_cap=0), _inputs())
        self.assertEqual(result.quantity, 0)

    def test_unknown_multiplier_makes_required_collateral_unknown_and_sizing_non_executable(self):
        # "Unknown multiplier -> non-executable": this is exactly the
        # UNKNOWN_INPUT path already in compute_sizing, reached here via
        # episode_economics.secured_capital's own None-on-unverified-
        # multiplier discipline feeding required_collateral_per_contract.
        sys.path.insert(0, str(_QUANT_DIR))
        from research.episode_economics import SecuredCapitalInputs, secured_capital

        unverified_capital_per_contract = secured_capital(SecuredCapitalInputs(strike=150.0, contracts=1.0, multiplier=None))
        self.assertIsNone(unverified_capital_per_contract)

        result = compute_sizing(_policy(), _inputs(required_collateral_per_contract=unverified_capital_per_contract))
        self.assertEqual(result.quantity, 0)
        self.assertEqual(result.binding_constraint, "UNKNOWN_INPUT")


if __name__ == "__main__":
    unittest.main()
