"""Contract tests for the production boundary around regime_v0. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.regime_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _inputs(**overrides):
    base = {
        "maSlope": 0.02, "rv20": 0.15, "maxAdverseGap": 0.01, "earningsDistanceDays": 40,
        "corporateActionPending": False, "macroRiskFlag": False, "spreadPct": 0.01,
        "portfolioOrMarketDrawdown": -0.02,
    }
    base.update(overrides)
    return base


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": "snap-1",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "regime-v0-test", "bullMaSlopeFloor": 0.01, "bearMaSlopeCeiling": -0.01,
            "rvLowCeiling": 0.1, "rvHighFloor": 0.25, "rvShockFloor": 0.4,
            "maxAdverseGapShockThreshold": 0.08, "liquidityThinSpreadPctFloor": 0.03,
            "liquidityDislocatedSpreadPctFloor": 0.08, "correctionDrawdownCeiling": -0.1,
            "crisisDrawdownCeiling": -0.2,
        },
        "inputs": _inputs(),
    }
    request.update(overrides)
    return request


class RegimeContractTests(unittest.TestCase):
    def test_all_five_axes_resolve_with_full_confidence(self):
        response = evaluate_request(_request())
        self.assertEqual(response["trendState"], "BULL")
        self.assertEqual(response["confidence"], 1.0)

    def test_unknown_axis_input_lowers_confidence_without_a_fabricated_axis(self):
        request = _request()
        request["inputs"] = _inputs(rv20=None)
        response = evaluate_request(request)
        self.assertIsNone(response["volatilityState"])
        self.assertEqual(response["confidence"], 0.8)

    def test_axes_are_never_collapsed_into_one_score(self):
        response = evaluate_request(_request())
        for key in ("trendState", "volatilityState", "eventState", "liquidityState", "stressState"):
            self.assertIn(key, response)

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request(contractVersion="wrong"))


if __name__ == "__main__":
    unittest.main()
