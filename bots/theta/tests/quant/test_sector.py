"""Tests for bots/theta/quant/features/sector.py (work package 13)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.sector import SectorObservation, sector_result  # noqa: E402


class TestSectorResult(unittest.TestCase):
    def test_known_sector_is_ok(self):
        observation = SectorObservation(
            underlying_symbol="AAPL", sector_code="45", sector_classification_scheme="GICS",
            provider="OPTIONOMICS", as_of="t", retrieved_at="t",
        )
        result = sector_result(observation)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["sectorCode"], "45")

    def test_no_authorized_source_is_unknown_never_scraped(self):
        observation = SectorObservation(
            underlying_symbol="AAPL", sector_code=None, sector_classification_scheme=None,
            provider=None, as_of="t", retrieved_at="t",
        )
        result = sector_result(observation)
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)
        self.assertIn("CODEX_HANDOFF_WP13", result.reason_codes[0])

    def test_version_mismatch_missing_scheme_is_invalid(self):
        observation = SectorObservation(
            underlying_symbol="AAPL", sector_code="45", sector_classification_scheme=None,
            provider="OPTIONOMICS", as_of="t", retrieved_at="t",
        )
        result = sector_result(observation)
        self.assertEqual(result.state, FeatureResultState.INVALID)


if __name__ == "__main__":
    unittest.main()
