"""Contract tests for the production boundary around assignment_model.
Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.assignment_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

HASH = "b" * 64


def _base_request(**candidate_overrides):
    candidate = {
        "strike": 50.0, "multiplier": 100.0, "entryPremiumPerShare": 0.60,
        "ownershipAcceptability": 0.8, "pSevereDrawdown": 0.05,
        "mechanicalCloseDebitPerShare": 0.90, "capitalCommitted": 5000.0,
    }
    candidate.update(candidate_overrides)
    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1",
        "snapshotId": "snapshot-1",
        "fusionSnapshotHash": HASH,
        "timestamp": "2026-09-11T15:00:00Z",
        "policy": {
            "policyVersion": "assign-v1-test", "ownershipAcceptabilityFloor": 0.5, "tailRiskPenaltyWeight": 1.0,
        },
        "candidate": candidate,
    }


class AssignmentContractTests(unittest.TestCase):
    def test_contract_version_mismatch_is_rejected(self):
        request = _base_request()
        request["contractVersion"] = "wrong-version"
        with self.assertRaises(ValueError):
            evaluate_request(request)

    def test_invalid_fusion_snapshot_hash_is_rejected(self):
        request = _base_request()
        request["fusionSnapshotHash"] = "not-a-hash"
        with self.assertRaises(ValueError):
            evaluate_request(request)

    def test_response_echoes_decision_snapshot_and_hash_identifiers(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["decisionId"], "decision-1")
        self.assertEqual(response["snapshotId"], "snapshot-1")
        self.assertEqual(response["fusionSnapshotHash"], HASH)

    def test_ownership_acceptable_recommends_accept_assignment(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["recommendation"], "ACCEPT_ASSIGNMENT")
        self.assertTrue(response["ownershipAcceptable"])

    def test_ownership_unacceptable_recommends_close_stock(self):
        response = evaluate_request(_base_request(ownershipAcceptability=0.1))
        self.assertEqual(response["recommendation"], "CLOSE_STOCK")
        self.assertFalse(response["ownershipAcceptable"])

    def test_unknown_ownership_never_defaults_to_a_recommendation(self):
        response = evaluate_request(_base_request(ownershipAcceptability=None))
        self.assertEqual(response["recommendation"], "UNKNOWN")
        self.assertIsNone(response["ownershipAcceptable"])

    def test_unknown_tail_risk_blocks_accept_recommendation(self):
        response = evaluate_request(_base_request(pSevereDrawdown=None))
        self.assertEqual(response["recommendation"], "UNKNOWN")

    def test_economic_basis_matches_strike_minus_entry_premium(self):
        response = evaluate_request(_base_request(strike=50.0, entryPremiumPerShare=0.60))
        self.assertAlmostEqual(response["economicBasisPerShare"], 49.40, places=6)

    def test_missing_capital_committed_is_rejected_not_defaulted(self):
        request = _base_request()
        del request["candidate"]["capitalCommitted"]
        with self.assertRaises(ValueError):
            evaluate_request(request)


if __name__ == "__main__":
    unittest.main()
