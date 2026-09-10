"""Contract tests for the production boundary around strategy_router. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.strategy_router_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": "snap-1",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "router-v1-test", "thetaQMinOwnershipAcceptability": 0.5,
            "thetaHMinOwnershipAcceptability": 0.75, "thetaDGateSatisfied": False,
        },
        "portfolio": {
            "lifecycleState": "CASH_AVAILABLE", "stockSharesHeld": 0.0,
            "openOptionExists": False, "assignmentImminent": False,
        },
        "market": {
            "ownershipAcceptable": 0.8, "liquidityAcceptable": True, "eventNear": False,
            "criticalDataValid": True,
        },
    }
    request.update(overrides)
    return request


class StrategyRouterContractTests(unittest.TestCase):
    def test_every_family_gets_a_result_never_a_partial_vote(self):
        response = evaluate_request(_request())
        self.assertEqual(len(response["results"]), 6)
        families = {r["strategyFamily"] for r in response["results"]}
        self.assertEqual(families, {"THETA_Q", "THETA_H", "THETA_R", "THETA_A", "THETA_C", "THETA_D"})

    def test_cash_available_makes_theta_q_eligible_and_theta_r_ineligible(self):
        response = evaluate_request(_request())
        by_family = {r["strategyFamily"]: r for r in response["results"]}
        self.assertTrue(by_family["THETA_Q"]["eligible"])
        self.assertFalse(by_family["THETA_R"]["eligible"])

    def test_invalid_critical_data_excludes_every_family(self):
        request = _request()
        request["market"]["criticalDataValid"] = False
        response = evaluate_request(request)
        self.assertTrue(all(not r["eligible"] for r in response["results"]))

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request(contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
