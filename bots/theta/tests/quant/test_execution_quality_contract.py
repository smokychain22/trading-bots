"""Contract tests for the production boundary around execution_quality.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.execution_quality_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1",
        "snapshotId": "snap-1",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "execq-v1-test", "maxAcceptableSpreadPct": 0.1,
            "minQuoteSizeForFullConfidence": 20, "maxQuoteAgeSeconds": 5.0,
            "minAfterCostUtilityToCross": 0.0,
        },
        "inputs": {
            "positionIntent": "SELL_TO_OPEN",
            "bid": 0.95, "ask": 1.05, "quoteSize": 25, "quoteAgeSeconds": 1.0,
            "limitPrice": 1.0, "preSlippageExpectedUtility": 50.0,
            "utilityEvidenceState": "EMPIRICAL_ESTIMATE",
        },
    }
    request.update(overrides)
    return request


class ExecutionQualityContractTests(unittest.TestCase):
    def test_acceptable_quote_recommends_submit(self):
        response = evaluate_request(_request())
        self.assertTrue(response["acceptable"])
        self.assertEqual(response["recommendedAction"], "SUBMIT")
        self.assertEqual(response["positionIntent"], "SELL_TO_OPEN")
        self.assertEqual(response["utilityEvidenceState"], "EMPIRICAL_ESTIMATE")

    def test_unknown_quote_never_recommends_submit(self):
        request = _request()
        request["inputs"]["bid"] = None
        response = evaluate_request(request)
        self.assertIsNone(response["acceptable"])
        self.assertEqual(response["recommendedAction"], "UNKNOWN")

    def test_negative_after_cost_utility_cancels_rather_than_crossing_blindly(self):
        request = _request()
        request["inputs"]["preSlippageExpectedUtility"] = 0.02
        request["inputs"]["limitPrice"] = 1.05  # seller starts at ask; reaching bid concedes the full spread
        response = evaluate_request(request)
        self.assertFalse(response["acceptable"])
        self.assertEqual(response["recommendedAction"], "CANCEL")

    def test_uncalibrated_paper_bootstrap_can_pass_without_fabricated_utility(self):
        request = _request()
        request["inputs"].update({
            "limitPrice": request["inputs"]["bid"],
            "preSlippageExpectedUtility": None,
            "utilityEvidenceState": "PAPER_BOOTSTRAP_UNCALIBRATED",
        })
        response = evaluate_request(request)
        self.assertTrue(response["acceptable"])
        self.assertEqual(response["recommendedAction"], "SUBMIT")
        self.assertEqual(response["expectedSlippagePerShare"], 0)
        self.assertEqual(response["utilityEvidenceState"], "PAPER_BOOTSTRAP_UNCALIBRATED")

    def test_uncalibrated_paper_bootstrap_still_rejects_stale_quote(self):
        request = _request()
        request["inputs"].update({
            "quoteAgeSeconds": 10.0,
            "limitPrice": request["inputs"]["bid"],
            "preSlippageExpectedUtility": None,
            "utilityEvidenceState": "PAPER_BOOTSTRAP_UNCALIBRATED",
        })
        response = evaluate_request(request)
        self.assertFalse(response["acceptable"])
        self.assertEqual(response["recommendedAction"], "SKIP")

    def test_utility_value_and_evidence_state_must_agree(self):
        request = _request()
        request["inputs"]["preSlippageExpectedUtility"] = None
        with self.assertRaisesRegex(ValueError, "EMPIRICAL_ESTIMATE requires"):
            evaluate_request(request)

        request = _request()
        request["inputs"]["utilityEvidenceState"] = "UNAVAILABLE"
        with self.assertRaisesRegex(ValueError, "requires preSlippageExpectedUtility=null"):
            evaluate_request(request)

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request(contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
