"""Tests for bots/theta/quant/features/feature_definitions_registry.py
(work package 21).
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_bundle import CANONICAL_FAMILIES  # noqa: E402
from features.feature_definitions_registry import (  # noqa: E402
    FEATURE_DEFINITIONS_REGISTRY, assert_registered_version, is_registered_version,
)
from features.trend import trend_feature_to_result, moving_average_slope  # noqa: E402


class TestFeatureDefinitionsRegistry(unittest.TestCase):
    def test_every_canonical_family_has_at_least_one_registered_definition(self):
        registered_families = {entry.family for entry in FEATURE_DEFINITIONS_REGISTRY.values()}
        self.assertEqual(registered_families, set(CANONICAL_FAMILIES))

    def test_real_producer_version_is_registered(self):
        self.assertTrue(is_registered_version("TREND", "trend-ma-slope-v1"))

    def test_unregistered_version_is_rejected(self):
        with self.assertRaises(ValueError):
            assert_registered_version("TREND", "some-made-up-version-v99")

    def test_wrong_family_for_a_real_version_is_rejected(self):
        with self.assertRaises(ValueError):
            assert_registered_version("MOMENTUM", "trend-ma-slope-v1")

    def test_actual_trend_feature_result_version_passes_the_registry_check(self):
        closes = [100.0 * (1.01 ** i) for i in range(40)]
        raw = moving_average_slope(closes, 39, ma_window=10, slope_window=5)
        result = trend_feature_to_result(raw, as_of="t", retrieved_at="t")
        assert_registered_version(result.family, result.version)  # must not raise


if __name__ == "__main__":
    unittest.main()
