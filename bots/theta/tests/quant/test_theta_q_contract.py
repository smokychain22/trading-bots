"""Contract tests for the production boundary around THETA-Q. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.theta_q_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _request():
    return {
        "contractVersion": CONTRACT_VERSION,
        "operation": "evaluateCspCandidates",
        "fusionSnapshotHash": "a" * 64,
        "latticeConfig": {
            "configVersion": "lattice-v1",
            "minDte": 30,
            "maxDte": 60,
            "deltaBands": [[0.10, 0.20], [0.20, 0.30]],
            "minOpenInterest": 50,
            "minVolume": 10,
            "maxSpreadPct": 0.08,
            "earningsExclusionDays": 5,
        },
        "sizingPolicy": {
            "riskLimitVersion": "risk-v1",
            "maxSpreadPct": 0.08,
            "maxQuoteAgeSeconds": 5,
            "minOpenInterest": 50,
            "minVolume": 10,
            "earningsExclusionDays": 5,
            "ownershipAcceptabilityFloor": 0.5,
            "exceptionalUtilityThreshold": 0.9,
            "strongUtilityThreshold": 0.7,
            "minimumPositiveEdge": 0.05,
            "riskBudgetQtyCap": 4,
            "collateralQtyCap": 3,
            "concentrationQtyCap": 2,
        },
        "costAssumptions": {
            "commissionPerContract": 0.65,
            "feesPerContract": 0.05,
            "estimatedSlippagePerContract": 1.0,
            "costModelVersion": "cost-v1",
        },
        "candidates": [
            {
                "candidateId": "candidate-1",
                "underlyingSymbol": "SYN",
                "dte": 45,
                "strike": 50.0,
                "putDeltaMagnitude": 0.22,
                "spreadPct": 0.03,
                "quoteAgeSeconds": 1.0,
                "openInterest": 200,
                "volume": 50,
                "earningsDistanceDays": 30,
                "multiplier": 100,
                "entryPremiumPerShare": 1.5,
                "ownershipAcceptability": 0.8,
                "severeDrawdownProbability": 0.1,
                "ivRank": None,
                "brokerAllowedQty": 5,
                "contractIsStandard": True,
            },
            {
                "candidateId": "candidate-rejected",
                "underlyingSymbol": "SYN",
                "dte": 10,
                "strike": 45.0,
                "putDeltaMagnitude": 0.15,
                "spreadPct": 0.03,
                "quoteAgeSeconds": 1.0,
                "openInterest": 200,
                "volume": 50,
                "earningsDistanceDays": 30,
                "multiplier": 100,
                "entryPremiumPerShare": 1.0,
                "ownershipAcceptability": 0.8,
                "severeDrawdownProbability": 0.1,
                "ivRank": 0.4,
                "brokerAllowedQty": 5,
                "contractIsStandard": True,
            },
        ],
    }


class ThetaQContractTests(unittest.TestCase):
    def test_preserves_all_candidates_and_wait(self):
        response = evaluate_request(_request())
        self.assertEqual(len(response["candidates"]), 2)
        self.assertEqual(response["wait"]["candidateId"], "WAIT")
        self.assertEqual(response["recommendation"]["selectedCandidateId"], "candidate-1")
        self.assertFalse(response["recommendation"]["executionAuthorized"])

    def test_rejected_candidate_keeps_reason_and_zero_quantity(self):
        response = evaluate_request(_request())
        rejected = next(item for item in response["candidates"] if item["candidateId"] == "candidate-rejected")
        self.assertFalse(rejected["actionFeasible"])
        self.assertEqual(rejected["quantity"], 0)
        self.assertIn("DTE_OUTSIDE_LATTICE", [reason["code"] for reason in rejected["reasons"]])

    def test_unknown_ownership_yields_wait_without_zero_imputation(self):
        request = _request()
        request["candidates"] = [request["candidates"][0]]
        request["candidates"][0]["ownershipAcceptability"] = None
        response = evaluate_request(request)
        self.assertEqual(response["recommendation"]["actionCode"], "WAIT")
        self.assertEqual(response["recommendation"]["quantity"], 0)
        self.assertIn(
            "OWNERSHIP_ACCEPTABILITY_UNKNOWN",
            [reason["code"] for reason in response["candidates"][0]["reasons"]],
        )

    def test_duplicate_candidate_ids_are_rejected(self):
        request = _request()
        request["candidates"][1]["candidateId"] = "candidate-1"
        with self.assertRaisesRegex(ValueError, "candidateId values must be unique"):
            evaluate_request(request)


if __name__ == "__main__":
    unittest.main()
