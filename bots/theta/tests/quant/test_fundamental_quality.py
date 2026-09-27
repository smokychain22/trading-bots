"""Tests for bots/theta/quant/features/fundamental_quality.py (work package 17)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResultState  # noqa: E402
from features.fundamental_quality import FundamentalQualityObservation, fundamental_quality_result  # noqa: E402


class TestFundamentalQualityResult(unittest.TestCase):
    def test_no_authorized_source_is_unknown_never_fabricated(self):
        observation = FundamentalQualityObservation(
            underlying_symbol="AAPL", metric_name=None, metric_value=None, provider=None, as_of="t", retrieved_at="t")
        result = fundamental_quality_result(observation)
        self.assertEqual(result.state, FeatureResultState.UNKNOWN)
        self.assertIn("CODEX_HANDOFF_WP17", result.reason_codes[0])

    def test_real_provider_metric_is_ok(self):
        observation = FundamentalQualityObservation(
            underlying_symbol="AAPL", metric_name="CREDIT_RATING_SCORE", metric_value=0.8,
            provider="OPTIONOMICS", as_of="t", retrieved_at="t")
        result = fundamental_quality_result(observation)
        self.assertEqual(result.state, FeatureResultState.OK)
        self.assertEqual(result.value, 0.8)


if __name__ == "__main__":
    unittest.main()
