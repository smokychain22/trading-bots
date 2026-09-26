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
            "maxAssignmentCapacityPct": 0.5, "maxRecoveryCapacityPct": 0.3, "hardCapMultiplier": 1.5,
            "compoundStressHoldCount": 2,
            "providerRequiredStates": ["OK"],
        },
        "inputs": _inputs(),
    }
    request.update(overrides)
    return request


class AegisContractTests(unittest.TestCase):
    def test_all_clear_inputs_yield_allow_full(self):
        response = evaluate_request(_request())
        self.assertEqual(response["newRiskState"], "ALLOW_FULL")
        self.assertEqual(response["compoundStressHoldCount"], 2)
        self.assertRegex(response["policyConfigurationHash"], r"^[a-f0-9]{64}$")

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

    def test_malformed_hard_cap_multiplier_is_rejected_not_silently_accepted(self):
        # Phase 4 (directive item 47): a hard_cap_multiplier <= 1 would
        # collapse the ALLOW_REDUCED tier (HARD_VETO would fire at or below
        # the soft cap) -- must be rejected, not silently accepted.
        for bad_value in (0, -1.5, 1, float("nan")):
            request = _request()
            request["policy"]["hardCapMultiplier"] = bad_value
            with self.assertRaises(ValueError):
                evaluate_request(request)

    def test_malformed_compound_stress_hold_count_is_rejected_not_silently_accepted(self):
        # A count < 2 would make HOLD_ONLY fire on a single stress signal
        # (indistinguishable from the sub-threshold ALLOW_REDUCED case), or
        # a non-integer/boolean would be a real type-confusion risk.
        for bad_value in (0, 1, -2, 1.5, True):
            request = _request()
            request["policy"]["compoundStressHoldCount"] = bad_value
            with self.assertRaises(ValueError):
                evaluate_request(request)

    def test_optional_cold_start_applicability_is_explicit_and_validated(self):
        request = _request()
        request["inputs"] = _inputs(
            stressSpreadWideningDetected=None,
            stressSpreadWideningApplicability="PAPER_COLD_START_NOT_APPLICABLE",
        )
        self.assertEqual(evaluate_request(request)["newRiskState"], "ALLOW_FULL")
        request["inputs"]["stressSpreadWideningApplicability"] = "IGNORE_UNKNOWN"
        with self.assertRaises(ValueError):
            evaluate_request(request)


if __name__ == "__main__":
    unittest.main()
