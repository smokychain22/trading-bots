"""SIZE-FLOAT-01: integer-cents contract affordability (one cent below / exact / one cent above)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "quant"))

from models.aegis import RiskState  # noqa: E402
from models.sizing import SizingInputs, SizingPolicy, compute_sizing, whole_contracts_affordable  # noqa: E402

STRIKES = [1.09, 1.1, 1.15, 2.3, 4.35, 7.07, 12.55, 19.99, 33.33, 57.14, 190.05, 706.01]


def _policy() -> SizingPolicy:
    return SizingPolicy(policy_version="t", risk_budget_qty_cap=99, collateral_qty_cap=99, concentration_qty_cap=99,
                        assignment_capacity_qty_cap=99, tail_risk_qty_cap=99, correlation_qty_cap=99,
                        liquidity_qty_cap=99, reduced_state_multiplier=0.5)


class CentsBoundary(unittest.TestCase):
    def test_boundaries(self):
        for strike in STRIKES:
            collateral = strike * 100
            unit_cents = round(strike * 10_000)
            for k in (1, 2, 3, 7):
                self.assertEqual(whole_contracts_affordable(unit_cents * k / 100, collateral), k, (strike, k))
                self.assertEqual(whole_contracts_affordable((unit_cents * k - 1) / 100, collateral), k - 1, (strike, k))
                self.assertEqual(whole_contracts_affordable((unit_cents * k + 1) / 100, collateral), k, (strike, k))

    def test_compute_sizing_exact_fit(self):
        inputs = SizingInputs(equity=1000.0, cash=1000.0, buying_power=109.0, required_collateral_per_contract=1.09 * 100,
                              broker_allowed_qty=50, risk_state=RiskState.ALLOW_FULL)
        result = compute_sizing(_policy(), inputs)
        self.assertEqual(result.quantity, 1)
        below = SizingInputs(equity=1000.0, cash=1000.0, buying_power=108.99, required_collateral_per_contract=1.09 * 100,
                             broker_allowed_qty=50, risk_state=RiskState.ALLOW_FULL)
        self.assertEqual(compute_sizing(_policy(), below).quantity, 0)


if __name__ == "__main__":
    unittest.main()
