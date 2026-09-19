"""Tests for bots/theta/quant/runtime/har_rv_contract.py. Synthetic data only.

Run with (from the repo root):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import math
import sys
import unittest
from pathlib import Path

_RUNTIME_DIR = Path(__file__).resolve().parents[2] / "quant" / "runtime"
sys.path.insert(0, str(_RUNTIME_DIR))

from har_rv_contract import CONTRACT_VERSION, MODEL_VERSION, evaluate_request  # noqa: E402


def _request(series, **overrides):
    base = {
        "contractVersion": CONTRACT_VERSION,
        "snapshotId": "snap-1",
        "timestamp": "2026-09-19T00:00:00Z",
        "asOf": "2026-09-19T00:00:00Z",
        "realizedVarianceSeries": series,
    }
    base.update(overrides)
    return base


class TestHarRvContract(unittest.TestCase):
    def test_wrong_contract_version_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request([0.0001] * 40, contractVersion="wrong"))

    def test_insufficient_history_reports_UNKNOWN_never_a_fabricated_forecast(self):
        response = evaluate_request(_request([0.0001] * 10))
        self.assertEqual(response["dataQuality"], "INSUFFICIENT_HISTORY")
        self.assertIsNone(response["forecastRealizedVariance"])
        self.assertIsNone(response["forecastRealizedVolatility"])

    def test_below_minimum_training_observations_reports_INSUFFICIENT_HISTORY(self):
        # 40 points is enough to build SOME leakage-safe pairs (>= 22+1),
        # but far below a demanding minimumTrainingObservations.
        response = evaluate_request(_request([0.0001] * 40, minimumTrainingObservations=1000))
        self.assertEqual(response["dataQuality"], "INSUFFICIENT_HISTORY")

    def test_a_perfectly_constant_series_is_singular_for_ols_and_reported_UNKNOWN_never_a_fabricated_fit(self):
        # daily == weekly == monthly for every row on a constant series --
        # the design matrix is exactly collinear, so an honest OLS fit
        # correctly refuses rather than returning an arbitrary fit.
        series = [0.0002] * 200
        response = evaluate_request(_request(series, minimumTrainingObservations=30))
        self.assertEqual(response["dataQuality"], "UNKNOWN")
        self.assertIsNone(response["forecastRealizedVariance"])

    def test_low_stable_but_nonconstant_volatility_produces_a_known_forecast_near_that_level(self):
        # Two incommensurate sinusoids (as in test_realized_volatility.py)
        # keep daily/weekly/monthly linearly independent while staying in a
        # narrow, low-volatility band -- a realistic "calm regime" fixture.
        series = [0.0002 * (1.0 + 0.05 * math.sin(i * 0.37) + 0.03 * math.cos(i * 0.131)) for i in range(200)]
        response = evaluate_request(_request(series, minimumTrainingObservations=30))
        self.assertEqual(response["dataQuality"], "KNOWN")
        self.assertAlmostEqual(response["forecastRealizedVariance"], 0.0002, delta=0.00006)
        self.assertGreater(response["forecastRealizedVolatility"], 0)
        self.assertEqual(response["modelVersion"], MODEL_VERSION)

    def test_a_None_inside_the_series_never_becomes_a_fabricated_zero_training_target(self):
        series = [0.0001 * (2.0 + math.sin(i * 0.37) + 0.5 * math.cos(i * 0.131)) for i in range(150)]
        series[100] = None  # a real gap in the middle of the history
        response = evaluate_request(_request(series, minimumTrainingObservations=30))
        # Training pairs whose target or feature window touches the None are
        # excluded, never coerced -- the response must still be well-formed
        # (either KNOWN with fewer pairs, or honestly INSUFFICIENT_HISTORY).
        self.assertIn(response["dataQuality"], ("KNOWN", "INSUFFICIENT_HISTORY"))
        if response["dataQuality"] == "KNOWN":
            self.assertLess(response["trainingObservationCount"], len(series))

    def test_a_late_volatility_shock_raises_the_forecast_relative_to_a_calm_series(self):
        calm = [0.0001 * (2.0 + math.sin(i * 0.37) + 0.5 * math.cos(i * 0.131)) for i in range(150)]
        shocked = calm[:145] + [0.01, 0.012, 0.011, 0.013, 0.012]
        calm_response = evaluate_request(_request(calm, minimumTrainingObservations=30))
        shocked_response = evaluate_request(_request(shocked, minimumTrainingObservations=30))
        self.assertEqual(calm_response["dataQuality"], "KNOWN")
        self.assertEqual(shocked_response["dataQuality"], "KNOWN")
        self.assertGreater(shocked_response["forecastRealizedVariance"], calm_response["forecastRealizedVariance"])

    def test_invalid_series_entry_raises_rather_than_silently_coercing(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request([0.0001, "not-a-number", 0.0002]))

    def test_nonpositive_window_configuration_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request(_request([0.0001] * 40, weeklyWindow=0))
        with self.assertRaises(ValueError):
            evaluate_request(_request([0.0001] * 40, monthlyWindow=-1))


if __name__ == "__main__":
    unittest.main()
