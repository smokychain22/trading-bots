"""Contract tests for the production boundary around sizing.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.sizing_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1",
        "snapshotId": "snap-1",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "sizing-v1-test", "riskBudgetQtyCap": 4, "collateralQtyCap": 3,
            "concentrationQtyCap": 5, "assignmentCapacityQtyCap": 6, "reducedStateMultiplier": 0.5,
        },
        "inputs": {
            "equity": 100_000.0, "cash": 50_000.0, "buyingPower": 40_000.0,
            "requiredCollateralPerContract": 5_000.0, "brokerAllowedQty": 10, "riskState": "ALLOW_FULL",
        },
    }
    request.update(overrides)
    return request


class SizingContractTests(unittest.TestCase):
    def test_tightest_cap_wins(self):
        response = evaluate_request(_request())
        self.assertEqual(response["quantity"], 3)  # collateralQtyCap is the binding cap here
        self.assertEqual(response["bindingConstraint"], "COLLATERAL_CAP")

    def test_hard_veto_risk_state_sizes_to_zero_never_floored(self):
        request = _request()
        request["inputs"]["riskState"] = "HARD_VETO"
        response = evaluate_request(request)
        self.assertEqual(response["quantity"], 0)
        self.assertIsNone(response["capitalRequired"])

    def test_unknown_buying_power_sizes_to_zero_not_a_default(self):
        request = _request()
        request["inputs"]["buyingPower"] = None
        response = evaluate_request(request)
        self.assertEqual(response["quantity"], 0)

    def test_zero_quantity_never_carries_a_nonzero_capital_requirement(self):
        request = _request()
        request["inputs"]["riskState"] = "HARD_VETO"
        response = evaluate_request(request)
        self.assertEqual(response["quantity"], 0)
        self.assertIn(response["capitalRequired"], (None, 0))

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request(contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
