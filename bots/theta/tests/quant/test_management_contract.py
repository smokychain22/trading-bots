"""Contract tests for the production boundary around management_action_value.
Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.management_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

HASH = "a" * 64


def _base_request(**context_overrides):
    context = {
        "asOf": "2026-09-10T15:00:00Z",
        "openOptionLeg": {
            "entryCreditPerShare": 4.5, "currentBidPerShare": 1.0, "currentAskPerShare": 1.2,
            "strike": 500, "multiplier": 100, "dte": 10,
        },
        "capitalCommitted": 50000,
        "pSevereDrawdown": 0.05,
        "atExpirationOtm": False,
    }
    context.update(context_overrides)
    return {
        "contractVersion": CONTRACT_VERSION,
        "decisionId": "decision-1",
        "snapshotId": "snapshot-1",
        "fusionSnapshotHash": HASH,
        "timestamp": "2026-09-10T15:00:00Z",
        "policy": {
            "policyVersion": "mgmt-v1-test", "executionCostPerContract": 0.65,
            "capitalDaysPenaltyRate": 0.0001, "tailRiskPenaltyWeight": 0.02,
        },
        "context": context,
    }


class ManagementContractTests(unittest.TestCase):
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

    def test_a_favorable_close_is_selected_over_hold_with_unknown_forward_value(self):
        response = evaluate_request(_base_request())
        self.assertEqual(response["selectedAction"], "CLOSE")
        close = next(v for v in response["valuations"] if v["action"] == "CLOSE")
        self.assertAlmostEqual(close["utility"], 329.35, places=2)

    def test_hold_is_selected_by_default_when_no_alternative_has_a_known_utility(self):
        response = evaluate_request(_base_request(openOptionLeg=None))
        self.assertEqual(response["selectedAction"], "HOLD")
        self.assertTrue(any(r["code"] == "HOLD_SELECTED_AS_DEFAULT" for r in response["selectedReasons"]))

    def test_every_action_is_reported_even_when_infeasible(self):
        response = evaluate_request(_base_request(openOptionLeg=None))
        actions = {v["action"] for v in response["valuations"]}
        self.assertEqual(actions, {"HOLD", "CLOSE", "EXPIRE", "ROLL", "ASSIGN", "REDEPLOY"})

    def test_an_infeasible_action_never_carries_a_known_utility(self):
        response = evaluate_request(_base_request(openOptionLeg=None))
        for valuation in response["valuations"]:
            if not valuation["feasible"]:
                self.assertIsNone(valuation["utility"])

    def test_missing_current_ask_makes_close_utility_unknown_not_assumed_favorable(self):
        response = evaluate_request(_base_request(openOptionLeg={
            "entryCreditPerShare": 4.5, "currentBidPerShare": None, "currentAskPerShare": None,
            "strike": 500, "multiplier": 100, "dte": 10,
        }))
        close = next(v for v in response["valuations"] if v["action"] == "CLOSE")
        self.assertTrue(close["feasible"])
        self.assertIsNone(close["utility"])

    def test_hold_advantage_is_null_when_hold_utility_is_unknown(self):
        response = evaluate_request(_base_request())
        # HOLD's own utility is unknown in this fixture (no holdForwardValue
        # supplied) -- hold_advantage requires a known HOLD utility.
        self.assertIsNone(response["holdAdvantage"])

    def test_expire_is_selected_at_expiration_otm_over_a_close_requiring_a_debit(self):
        response = evaluate_request(_base_request(atExpirationOtm=True, openOptionLeg={
            "entryCreditPerShare": 4.5, "currentBidPerShare": 0.05, "currentAskPerShare": 0.1,
            "strike": 500, "multiplier": 100, "dte": 0,
        }))
        self.assertEqual(response["selectedAction"], "EXPIRE")

    def test_roll_requires_both_an_open_leg_and_a_roll_candidate(self):
        response = evaluate_request(_base_request(rollCandidate={
            "newStrike": 490, "newDte": 30, "newCreditPerShare": 5.0, "estimatedFutureValue": 100,
        }))
        roll = next(v for v in response["valuations"] if v["action"] == "ROLL")
        self.assertTrue(roll["feasible"])
        self.assertIsNotNone(roll["utility"])


if __name__ == "__main__":
    unittest.main()
