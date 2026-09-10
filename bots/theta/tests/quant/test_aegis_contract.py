"""Contract tests for the production boundary around aegis.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.aegis_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

EXIT_SUPREMACY_ACTIONS = {"CLOSE", "CANCEL", "BUY_TO_CLOSE", "RECONCILE", "REDUCE_POSITION", "SAFETY_EXIT"}


def _inputs(**overrides):
    base = {
        "tickerConcentrationPct": 0.05, "sectorConcentrationPct": 0.1, "correlationClusterExposurePct": 0.1,
        "portfolioCapitalAtRiskPct": 0.2, "inventoryCapacityUsedPct": 0.1, "assignmentCapacityUsedPct": 0.1,
        "recoveryCapacityUsedPct": 0.0, "liquidityAcceptable": True, "executionQualityAcceptable": True,
        "providerState": "OK", "stressGapDetected": False, "stressIvShockDetected": False,
        "stressSpreadWideningDetected": False,
    }
    base.update(overrides)
    return base


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1",
        "snapshotId": "snap-1",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "aegis-v1-test", "maxTickerConcentrationPct": 0.15, "maxSectorConcentrationPct": 0.3,
            "maxCorrelationClusterPct": 0.3, "maxPortfolioCapitalAtRiskPct": 0.5, "maxInventoryCapacityPct": 0.5,
            "maxAssignmentCapacityPct": 0.5, "maxRecoveryCapacityPct": 0.3, "providerRequiredStates": ["OK"],
        },
        "inputs": _inputs(),
    }
    request.update(overrides)
    return request


class AegisContractTests(unittest.TestCase):
    def test_all_clear_inputs_yield_allow_full(self):
        response = evaluate_request(_request())
        self.assertEqual(response["newRiskState"], "ALLOW_FULL")

    def test_exit_supremacy_actions_are_always_permitted_even_under_hard_veto(self):
        request = _request()
        request["inputs"] = _inputs(providerState="INVALID")
        response = evaluate_request(request)
        self.assertEqual(response["newRiskState"], "HARD_VETO")
        for action in EXIT_SUPREMACY_ACTIONS:
            self.assertIn(action, response["permittedActions"])
        self.assertNotIn("OPEN_CSP", response["permittedActions"])

    def test_unknown_input_maps_to_a_restrictive_state_never_permissive(self):
        request = _request()
        request["inputs"] = _inputs(liquidityAcceptable=None)
        response = evaluate_request(request)
        self.assertIn(response["newRiskState"], ("HOLD_ONLY", "HARD_VETO"))

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request(contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
