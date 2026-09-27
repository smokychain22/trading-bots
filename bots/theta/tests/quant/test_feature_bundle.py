"""Tests for bots/theta/quant/features/feature_bundle.py (work package 20)."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass  # noqa: E402
from features.feature_bundle import CANONICAL_FAMILIES, build_feature_bundle  # noqa: E402


def _ok_result(family: str) -> FeatureResult:
    return FeatureResult(
        feature_id=f"{family}_SPY", family=family, state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=1.0, structured_value=None,
        units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
        freshness_seconds=None, coverage=None, version="v1",
    )


class TestFeatureBundle(unittest.TestCase):
    def test_all_20_families_present_even_with_no_input(self):
        bundle = build_feature_bundle({}, "SPY", "t", "t")
        self.assertEqual(set(bundle.results.keys()), set(CANONICAL_FAMILIES))
        self.assertEqual(len(bundle.results), 20)

    def test_no_silent_omission_missing_families_are_explicit_unknown(self):
        bundle = build_feature_bundle({"TREND": _ok_result("TREND")}, "SPY", "t", "t")
        self.assertEqual(bundle.results["MOMENTUM"].state, FeatureResultState.UNKNOWN)
        self.assertIn("MOMENTUM", bundle.unknown_families)
        self.assertIn("MOMENTUM_NOT_YET_WIRED_INTO_BUNDLE", bundle.results["MOMENTUM"].reason_codes[0])

    def test_unknown_family_key_is_rejected(self):
        with self.assertRaises(ValueError):
            build_feature_bundle({"NOT_A_REAL_FAMILY": _ok_result("NOT_A_REAL_FAMILY")}, "SPY", "t", "t")

    def test_family_mismatch_rejected_never_silently_relabeled(self):
        mismatched = _ok_result("TREND")
        with self.assertRaises(ValueError):
            build_feature_bundle({"MOMENTUM": mismatched}, "SPY", "t", "t")

    def test_real_family_classification(self):
        bundle = build_feature_bundle({"TREND": _ok_result("TREND")}, "SPY", "t", "t")
        self.assertIn("TREND", bundle.real_families)

    def test_hash_is_deterministic(self):
        first = build_feature_bundle({"TREND": _ok_result("TREND")}, "SPY", "t", "t")
        second = build_feature_bundle({"TREND": _ok_result("TREND")}, "SPY", "t", "t")
        self.assertEqual(first.content_hash, second.content_hash)

    def test_hash_changes_with_different_content(self):
        first = build_feature_bundle({"TREND": _ok_result("TREND")}, "SPY", "t", "t")
        second = build_feature_bundle({}, "SPY", "t", "t")
        self.assertNotEqual(first.content_hash, second.content_hash)

    def test_canonical_families_list_has_no_duplicates(self):
        self.assertEqual(len(CANONICAL_FAMILIES), len(set(CANONICAL_FAMILIES)))
        self.assertEqual(len(CANONICAL_FAMILIES), 20)


if __name__ == "__main__":
    unittest.main()
