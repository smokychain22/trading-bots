"""Contract tests for the production boundary around covered_call_ranker.
Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.covered_call_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

HASH = "d" * 64


def _base_request(candidates=None, **stock_overrides):
    stock = {
        "shares": 100, "economicBasisPerShare": 48.0, "currentPricePerShare": 50.0, "stockEvIfUncapped": 5200.0,
    }
    stock.update(stock_overrides)
    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1", "snapshotId": "snapshot-1", "fusionSnapshotHash": HASH,
        "timestamp": "2026-09-11T15:00:00Z",
        "policy": {"policyVersion": "cc-v1-test", "executionCostPerContract": 0.65},
        "candidates": candidates if candidates is not None else [],
        "stock": stock,
    }


class CoveredCallContractTests(unittest.TestCase):
    def test_contract_version_mismatch_is_rejected(self):
        request = _base_request()
        request["contractVersion"] = "wrong-version"
        with self.assertRaises(ValueError):
            evaluate_request(request)

    def test_response_echoes_identifiers(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["decisionId"], "decision-1")
        self.assertEqual(response["fusionSnapshotHash"], HASH)

    def test_wait_is_selected_when_no_cc_candidate_beats_it(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["selectedLabel"], "WAIT")
        self.assertTrue(any(r["code"] == "WAIT_SELECTED_AS_DEFAULT" for r in response["selectedReasons"]))

    def test_a_favorable_cc_candidate_can_beat_wait_and_sell_stock(self):
        response = evaluate_request(_base_request(candidates=[{
            "strike": 55, "dte": 20, "creditPerShare": 5.0, "multiplier": 100,
            "callAwayRegretPerShare": 0.1, "eventRiskPenalty": 0.0,
        }], stockEvIfUncapped=100.0))
        self.assertTrue(response["selectedLabel"].startswith("SELL_CC"))

    def test_missing_credit_quote_makes_that_candidate_utility_unknown_not_favorable(self):
        response = evaluate_request(_base_request(candidates=[{
            "strike": 55, "dte": 20, "creditPerShare": None, "multiplier": 100,
            "callAwayRegretPerShare": 0.2, "eventRiskPenalty": 0.0,
        }]))
        cc_valuation = next(v for v in response["valuations"] if v["label"].startswith("SELL_CC"))
        self.assertIsNone(cc_valuation["utility"])

    def test_missing_call_away_regret_never_defaults_to_zero(self):
        response = evaluate_request(_base_request(candidates=[{
            "strike": 55, "dte": 20, "creditPerShare": 2.0, "multiplier": 100,
            "callAwayRegretPerShare": None, "eventRiskPenalty": 0.0,
        }]))
        cc_valuation = next(v for v in response["valuations"] if v["label"].startswith("SELL_CC"))
        self.assertIsNone(cc_valuation["utility"])
        self.assertTrue(any(r["code"] == "CALL_AWAY_REGRET_UNKNOWN" for r in cc_valuation["reasons"]))


if __name__ == "__main__":
    unittest.main()
