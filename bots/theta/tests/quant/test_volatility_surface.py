"""Tests for bots/theta/quant/features/volatility_surface.py (work package 07)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.volatility_surface import SurfaceCellObservation, volatility_surface_result  # noqa: E402


def _cell(expiration: str, dte: int, bucket: float, iv: float) -> SurfaceCellObservation:
    return SurfaceCellObservation(expiration_date=expiration, dte=dte, delta_bucket=bucket, iv=iv)


class TestVolatilitySurfaceResult(unittest.TestCase):
    def test_full_coverage(self):
        observations = [_cell("e1", 10, b, 0.2 + i * 0.01) for i, b in enumerate((0.10, 0.25, 0.40, 0.50))]
        result = volatility_surface_result(observations)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.coverage, 1.0)
        self.assertEqual(result.structured_value["observedCellCount"], 4)

    def test_partial_coverage(self):
        observations = [_cell("e1", 10, 0.25, 0.22), _cell("e1", 10, 0.50, 0.20)]
        result = volatility_surface_result(observations)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertLess(result.coverage, 1.0)
        missing = [cell for cell in result.structured_value["cells"] if cell["state"] == "MISSING"]
        self.assertEqual(len(missing), 2)

    def test_insufficient_coverage_below_threshold(self):
        observations = [_cell("e1", 10, 0.25, 0.22)]
        result = volatility_surface_result(observations, min_coverage_ratio=0.9)
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)
        self.assertIsNone(result.structured_value)

    def test_no_observations_is_insufficient(self):
        result = volatility_surface_result([])
        self.assertEqual(result.state, FeatureResultState.INSUFFICIENT_COVERAGE)

    def test_mixed_timestamps_across_expiries_are_kept_separate_never_blended(self):
        observations = [_cell("e1", 10, 0.25, 0.20), _cell("e2", 30, 0.25, 0.28)]
        result = volatility_surface_result(observations)
        expiries = result.structured_value["expiries"]
        self.assertEqual(len(expiries), 2)
        self.assertEqual(expiries, ["e1", "e2"])  # DTE ordered

    def test_hash_determinism(self):
        observations = [_cell("e1", 10, 0.25, 0.22), _cell("e1", 10, 0.50, 0.20)]
        first = volatility_surface_result(observations)
        second = volatility_surface_result(observations)
        self.assertEqual(first.content_hash(), second.content_hash())


if __name__ == "__main__":
    unittest.main()
