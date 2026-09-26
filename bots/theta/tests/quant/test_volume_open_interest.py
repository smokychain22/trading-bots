"""Tests for bots/theta/quant/features/volume_open_interest.py (work package 08)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.volume_open_interest import VolumeOpenInterestObservation, volume_open_interest_result  # noqa: E402


def _obs(**overrides) -> VolumeOpenInterestObservation:
    base = dict(
        option_symbol="SPY261016P00650000", session_volume=100, open_interest=1000,
        open_interest_explicitly_zero=False, provider_timestamp="t", as_of="t", retrieved_at="t",
    )
    base.update(overrides)
    return VolumeOpenInterestObservation(**base)


class TestVolumeOpenInterestResult(unittest.TestCase):
    def test_real_volume_and_oi_produce_ok_with_ratio(self):
        result = volume_open_interest_result(_obs())
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.structured_value["sessionVolume"], 100)
        self.assertEqual(result.structured_value["openInterest"], 1000)
        self.assertAlmostEqual(result.structured_value["volumeOpenInterestRatio"], 0.1)

    def test_missing_oi_is_never_coerced_to_zero(self):
        result = volume_open_interest_result(_obs(open_interest=None, open_interest_explicitly_zero=False))
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertIsNone(result.structured_value["openInterest"])
        self.assertEqual(result.structured_value["openInterestState"], "UNKNOWN")

    def test_explicit_zero_oi_is_accepted_as_real_zero(self):
        result = volume_open_interest_result(_obs(open_interest=None, open_interest_explicitly_zero=True))
        self.assertEqual(result.structured_value["openInterest"], 0)
        self.assertEqual(result.structured_value["openInterestState"], "GOOD")

    def test_stale_oi_is_marked_stale_not_used_in_ratio(self):
        result = volume_open_interest_result(_obs(max_oi_age_seconds=3600.0, oi_age_seconds=90000.0))
        self.assertEqual(result.structured_value["openInterestState"], "STALE")
        self.assertIsNone(result.structured_value["openInterest"])
        self.assertIsNone(result.structured_value["volumeOpenInterestRatio"])

    def test_same_day_volume_is_a_separate_field_from_oi(self):
        result = volume_open_interest_result(_obs())
        self.assertIn("sessionVolume", result.structured_value)
        self.assertIn("openInterest", result.structured_value)
        self.assertNotEqual(result.structured_value["sessionVolume"], result.structured_value["openInterest"])

    def test_nothing_reported_is_unknown(self):
        result = volume_open_interest_result(_obs(session_volume=None, open_interest=None, open_interest_explicitly_zero=False))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
