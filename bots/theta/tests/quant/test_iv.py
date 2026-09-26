"""Tests for bots/theta/quant/features/iv.py (work package 04)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState, FeatureTruthClass  # noqa: E402
from features.iv import IvContractObservation, iv_feature_result  # noqa: E402


def _observation(**overrides) -> IvContractObservation:
    base = dict(
        option_symbol="SPY261016P00650000", underlying_symbol="SPY", expiration_date="2026-10-16",
        strike=650.0, option_type="PUT", provider_iv=0.25, provider_timestamp="2026-09-27T14:00:00Z",
        as_of="2026-09-27T14:00:05Z", retrieved_at="2026-09-27T14:00:06Z",
    )
    base.update(overrides)
    return IvContractObservation(**base)


class TestIvFeatureResult(unittest.TestCase):
    def test_observed_iv_is_ok_and_market_observed(self):
        result = iv_feature_result(_observation())
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.truth_class, FeatureTruthClass.MARKET_OBSERVED)
        self.assertEqual(result.value, 0.25)

    def test_missing_iv_is_unknown_never_fabricated_from_midpoint(self):
        result = iv_feature_result(_observation(provider_iv=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)
        self.assertIsNone(result.value)

    def test_missing_provider_timestamp_is_unknown(self):
        result = iv_feature_result(_observation(provider_timestamp=None))
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)

    def test_bad_units_non_positive_iv_is_invalid(self):
        result = iv_feature_result(_observation(provider_iv=0.0))
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIsNone(result.value)
        result_negative = iv_feature_result(_observation(provider_iv=-0.1))
        self.assertEqual(result_negative.state, FeatureResultState.INVALID)

    def test_stale_quote_beyond_max_age_is_stale(self):
        result = iv_feature_result(_observation(
            as_of="2026-09-27T15:00:00Z", provider_timestamp="2026-09-27T14:00:00Z", max_quote_age_seconds=60.0))
        self.assertEqual(result.state, FeatureResultState.STALE)
        self.assertIsNone(result.value)

    def test_fresh_quote_within_max_age_is_ok(self):
        result = iv_feature_result(_observation(
            as_of="2026-09-27T14:00:05Z", provider_timestamp="2026-09-27T14:00:00Z", max_quote_age_seconds=60.0))
        self.assertEqual(result.state, FeatureResultState.OK)

    def test_contract_mismatch_bad_option_type_is_invalid(self):
        result = iv_feature_result(_observation(option_type="STRADDLE"))
        self.assertEqual(result.state, FeatureResultState.INVALID)
        self.assertIsNone(result.value)

    def test_feature_id_includes_option_symbol(self):
        result = iv_feature_result(_observation())
        self.assertIn("SPY261016P00650000", result.feature_id)


if __name__ == "__main__":
    unittest.main()
