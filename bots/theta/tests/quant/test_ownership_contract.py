"""Contract tests for the production boundary around ownership_v0. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.ownership_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402


def _inputs(**overrides):
    base = {
        "stockAvgVolume": 5_000_000.0, "optionOpenInterest": 500, "optionVolume": 100, "spreadPct": 0.02,
        "ret1d": 0.001, "ret5d": 0.01, "ret20d": 0.02, "ret60d": 0.05,
        "ma20Rel": 0.02, "ma50Rel": 0.03, "ma200Rel": 0.05, "maSlope": 0.01, "relativeStrength": 0.2,
        "rv10": 0.15, "rv20": 0.18, "rv60": 0.2,
        "drawdown": -0.05, "maxAdverseGap": 0.02, "gapFrequency": 0.1, "downsideSemivariance": 0.05,
        "historicalRecoveryMedianDays": 20.0, "historicalRecoveryP95Days": 60.0, "severeDrawdownEpisodeCount": 1,
        "earningsDistanceDays": 40, "exDividendDistanceDays": 90, "knownEventDistanceDays": None,
    }
    base.update(overrides)
    return base


def _request(**overrides):
    request = {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": "snap-1",
        "underlyingSymbol": "SYN",
        "timestamp": "2026-09-10T14:30:00Z",
        "policy": {
            "policyVersion": "ownership-v0-test", "minStockAvgVolume": 1_000_000, "minOptionOpenInterest": 100,
            "minOptionVolume": 10, "maxSpreadPct": 0.1, "rvNormalizationCeiling": 0.6,
            "downsideSemivarNormalizationCeiling": 0.3, "gapFrequencyNormalizationCeiling": 0.5,
            "eventDecayWindowDays": 10,
        },
        "inputs": _inputs(),
    }
    request.update(overrides)
    return request


class OwnershipContractTests(unittest.TestCase):
    def test_all_known_inputs_produce_a_computed_ownability(self):
        response = evaluate_request(_request())
        self.assertIsNotNone(response["ownability"])
        self.assertEqual(len(response["components"]), 5)

    def test_unknown_component_input_yields_unknown_ownability_not_a_default(self):
        request = _request()
        request["inputs"] = _inputs(stockAvgVolume=None)
        response = evaluate_request(request)
        self.assertIsNone(response["ownability"])
        liquidity = next(c for c in response["components"] if c["name"] == "LiquidityQuality")
        self.assertIsNone(liquidity["value"])

    def test_thesis_invalidated_surfaces_as_a_top_level_reason(self):
        request = _request()
        request["inputs"] = _inputs(thesisInvalidated=True)
        response = evaluate_request(request)
        self.assertTrue(response["thesisInvalidated"])
        self.assertIn("THESIS_INVALIDATED", [r["code"] for r in response["reasons"]])

    def test_wrong_contract_version_is_rejected(self):
        request = _request(contractVersion="wrong")
        with self.assertRaises(ValueError):
            evaluate_request(request)


if __name__ == "__main__":
    unittest.main()
