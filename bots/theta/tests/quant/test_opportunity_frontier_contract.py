"""Contract tests for the production boundary around opportunity_frontier.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.opportunity_frontier_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _candidate(candidate_id: str, **overrides):
    base = {
        "candidateId": candidate_id, "underlyingSymbol": "SYN", "evNet": 25.0, "returnPerCapitalDay": 0.01,
        "ownershipAcceptable": True, "liquidityAcceptable": True, "ivCompensationSufficient": True,
        "eventNear": False, "regimeAcceptable": True, "modelUncertainty": 0.1,
        "aegisPermitsFull": True, "aegisPermitsReduced": True, "hasAlternateContract": False,
        "hasAlternateExpiry": False, "hasAlternateStructure": False,
    }
    base.update(overrides)
    return base


def _request(candidates, **overrides):
    request = {
        "contractVersion": CONTRACT_VERSION, "snapshotId": "snap-1", "timestamp": "2026-09-10T14:30:00Z",
        "policy": {"policyVersion": "opp-frontier-v1-test", "reducedSizeUncertaintyThreshold": 0.5},
        "candidates": candidates,
    }
    request.update(overrides)
    return request


class OpportunityFrontierContractTests(unittest.TestCase):
    def test_a_qualifying_candidate_is_ranked_actionable(self):
        response = evaluate_request(_request([_candidate("c1")]))
        self.assertEqual(response["actionableCandidateIds"], ["c1"])
        self.assertIsNone(response["globalIdle"])

    def test_a_single_bad_candidate_never_suppresses_a_good_one(self):
        candidates = [_candidate("bad", evNet=-5.0), _candidate("good", evNet=25.0)]
        response = evaluate_request(_request(candidates))
        self.assertIn("good", response["actionableCandidateIds"])
        self.assertNotIn("bad", response["actionableCandidateIds"])

    def test_global_idle_proves_the_book_was_searched(self):
        candidates = [_candidate("only", evNet=-5.0)]
        response = evaluate_request(_request(candidates))
        self.assertEqual(response["actionableCandidateIds"], [])
        self.assertIsNotNone(response["globalIdle"])
        self.assertEqual(response["globalIdle"]["contractsEvaluated"], 1)

    def test_wait_entry_always_carries_a_specific_reason(self):
        candidates = [_candidate("event-near", eventNear=True)]
        response = evaluate_request(_request(candidates))
        entry = response["entries"][0]
        self.assertEqual(entry["disposition"], "WAIT")
        self.assertEqual(entry["waitReason"], "WAIT_EVENT")

    def test_duplicate_candidate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "candidateId values must be unique"):
            evaluate_request(_request([_candidate("dup"), _candidate("dup")]))

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request([_candidate("c1")], contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
