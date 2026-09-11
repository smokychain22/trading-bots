"""Contract tests for the production boundary around recovery_decision.
Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.recovery_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

HASH = "c" * 64


def _base_request(**candidate_overrides):
    candidate = {
        "daysInRecovery": 5, "thesisInvalidated": False, "coveredCallAvailable": False,
    }
    candidate.update(candidate_overrides)
    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1", "snapshotId": "snapshot-1", "fusionSnapshotHash": HASH,
        "timestamp": "2026-09-11T15:00:00Z",
        "policy": {"policyVersion": "recovery-v1-test", "maxWaitDays": 20},
        "candidate": candidate,
    }


class RecoveryContractTests(unittest.TestCase):
    def test_contract_version_mismatch_is_rejected(self):
        request = _base_request()
        request["contractVersion"] = "wrong-version"
        with self.assertRaises(ValueError):
            evaluate_request(request)

    def test_invalid_fusion_snapshot_hash_is_rejected(self):
        request = _base_request()
        request["fusionSnapshotHash"] = "nope"
        with self.assertRaises(ValueError):
            evaluate_request(request)

    def test_response_echoes_identifiers(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["decisionId"], "decision-1")
        self.assertEqual(response["snapshotId"], "snapshot-1")
        self.assertEqual(response["fusionSnapshotHash"], HASH)

    def test_within_bound_no_cc_continues_waiting(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["action"], "RECOVERY_WAIT")
        self.assertFalse(response["boundExceeded"])

    def test_thesis_invalidated_is_a_hard_exit_regardless_of_bound(self):
        response = evaluate_request(_base_request(thesisInvalidated=True, daysInRecovery=1))
        self.assertEqual(response["action"], "SELL_STOCK")
        self.assertFalse(response["boundExceeded"])

    def test_bound_exceeded_forces_sell_stock(self):
        response = evaluate_request(_base_request(daysInRecovery=25))
        self.assertEqual(response["action"], "SELL_STOCK")
        self.assertTrue(response["boundExceeded"])

    def test_positive_cc_utility_selects_sell_cc(self):
        response = evaluate_request(_base_request(coveredCallAvailable=True, bestCcUtility=50.0))
        self.assertEqual(response["action"], "SELL_CC")

    def test_negative_cc_utility_does_not_force_sell_cc(self):
        response = evaluate_request(_base_request(coveredCallAvailable=True, bestCcUtility=-10.0))
        self.assertEqual(response["action"], "RECOVERY_WAIT")

    def test_partial_sell_stock_is_explicitly_reported_as_not_modeled_never_fabricated(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["partialSellStock"], {"modeled": False})

    def test_missing_days_in_recovery_is_rejected_not_defaulted(self):
        request = _base_request()
        del request["candidate"]["daysInRecovery"]
        with self.assertRaises(ValueError):
            evaluate_request(request)


if __name__ == "__main__":
    unittest.main()
