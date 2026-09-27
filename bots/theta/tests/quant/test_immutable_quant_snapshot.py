"""Tests for bots/theta/quant/research/immutable_quant_snapshot.py (work
package 27): same frozen inputs -> same research feature/model outputs.
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from features.feature_bundle import build_feature_bundle  # noqa: E402
from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass  # noqa: E402
from models.regime_v0 import RegimeSnapshot, TrendState, VolatilityState  # noqa: E402
from research.immutable_quant_snapshot import QuantSnapshotVersions, build_immutable_quant_snapshot  # noqa: E402


def _trend_ok() -> FeatureResult:
    return FeatureResult(
        feature_id="TREND_SPY", family="TREND", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=0.02, structured_value=None,
        units="u", source_provider="p", source_operation="op", as_of="t", retrieved_at="t",
        freshness_seconds=None, coverage=None, version="v1",
    )


def _regime() -> RegimeSnapshot:
    return RegimeSnapshot(
        trend_state=TrendState.BULL, volatility_state=VolatilityState.NORMAL, event_state=None,
        liquidity_state=None, stress_state=None, confidence=0.4, reasons=[],
    )


def _versions() -> QuantSnapshotVersions:
    return QuantSnapshotVersions(
        strategy_version="s1", feature_version="f1", risk_version="r1", regime_version="rg1", router_version="ro1",
    )


class TestImmutableQuantSnapshot(unittest.TestCase):
    def test_same_frozen_inputs_produce_the_same_snapshot_hash(self):
        bundle = build_feature_bundle({"TREND": _trend_ok()}, "SPY", "2026-09-27T14:00:00Z", "t")
        first = build_immutable_quant_snapshot(bundle, _regime(), _versions())
        second = build_immutable_quant_snapshot(bundle, _regime(), _versions())
        self.assertEqual(first.snapshot_hash, second.snapshot_hash)

    def test_different_regime_produces_a_different_hash(self):
        bundle = build_feature_bundle({"TREND": _trend_ok()}, "SPY", "2026-09-27T14:00:00Z", "t")
        different_regime = RegimeSnapshot(
            trend_state=TrendState.BEAR, volatility_state=VolatilityState.NORMAL, event_state=None,
            liquidity_state=None, stress_state=None, confidence=0.4, reasons=[],
        )
        first = build_immutable_quant_snapshot(bundle, _regime(), _versions())
        second = build_immutable_quant_snapshot(bundle, different_regime, _versions())
        self.assertNotEqual(first.snapshot_hash, second.snapshot_hash)

    def test_snapshot_references_the_bundle_content_hash_never_recomputes_it(self):
        bundle = build_feature_bundle({"TREND": _trend_ok()}, "SPY", "2026-09-27T14:00:00Z", "t")
        snapshot = build_immutable_quant_snapshot(bundle, _regime(), _versions())
        self.assertEqual(snapshot.feature_bundle_content_hash, bundle.content_hash)

    def test_unknown_regime_axes_are_none_never_fabricated(self):
        bundle = build_feature_bundle({}, "SPY", "t", "t")
        unknown_regime = RegimeSnapshot(
            trend_state=None, volatility_state=None, event_state=None, liquidity_state=None, stress_state=None,
            confidence=0.0, reasons=[],
        )
        snapshot = build_immutable_quant_snapshot(bundle, unknown_regime, _versions())
        self.assertIsNone(snapshot.regime_trend_state)
        self.assertIsNone(snapshot.regime_volatility_state)


if __name__ == "__main__":
    unittest.main()
