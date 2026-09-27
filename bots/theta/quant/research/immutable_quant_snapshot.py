"""Immutable quant input snapshot contract (THETA long-run build, work
package 27, Phase 3: immutable decision truth research contract).

A typed, frozen, hashable snapshot of everything a research replay needs
to reproduce the SAME feature/model outputs from the SAME frozen inputs --
never a mutable provider handle (no live connection, no callable, only
already-computed, already-real data). This is additive to, not a
replacement for, `research/dataset_contracts.py`'s `DatasetExportArtifact`
(the Postgres-export intake gate, a different, pre-existing, mature
purpose) -- checked before writing this module to avoid the exact
duplicate-authority mistake this session's own EXECUTION_QUALITY work
package (WP19) already made and fixed once.
"""

from dataclasses import dataclass
from typing import Mapping, Optional

from features.feature_bundle import FeatureBundle
from features.feature_contract import _canonical_json, _sha256_text
from models.regime_v0 import RegimeSnapshot


@dataclass(frozen=True)
class QuantSnapshotVersions:
    strategy_version: str
    feature_version: str
    risk_version: str
    regime_version: str
    router_version: str


@dataclass(frozen=True)
class ImmutableQuantSnapshot:
    """Frozen by construction (a `frozen=True` dataclass of only frozen/
    immutable members) -- there is no mutable provider handle anywhere in
    this shape, only already-materialized values."""
    decision_timestamp: str
    underlying_symbol: str
    feature_bundle_content_hash: str  # the FeatureBundle's own hash, not a re-derived one
    regime_confidence: float
    regime_trend_state: Optional[str]
    regime_volatility_state: Optional[str]
    versions: QuantSnapshotVersions
    snapshot_hash: str


def build_immutable_quant_snapshot(
    feature_bundle: FeatureBundle, regime: RegimeSnapshot, versions: QuantSnapshotVersions,
) -> ImmutableQuantSnapshot:
    payload = {
        "decisionTimestamp": feature_bundle.decision_timestamp, "underlyingSymbol": feature_bundle.underlying_symbol,
        "featureBundleContentHash": feature_bundle.content_hash,
        "regimeConfidence": regime.confidence,
        "regimeTrendState": regime.trend_state.value if regime.trend_state is not None else None,
        "regimeVolatilityState": regime.volatility_state.value if regime.volatility_state is not None else None,
        "versions": {
            "strategyVersion": versions.strategy_version, "featureVersion": versions.feature_version,
            "riskVersion": versions.risk_version, "regimeVersion": versions.regime_version,
            "routerVersion": versions.router_version,
        },
    }
    snapshot_hash = _sha256_text(_canonical_json(payload))
    return ImmutableQuantSnapshot(
        decision_timestamp=feature_bundle.decision_timestamp, underlying_symbol=feature_bundle.underlying_symbol,
        feature_bundle_content_hash=feature_bundle.content_hash, regime_confidence=regime.confidence,
        regime_trend_state=payload["regimeTrendState"], regime_volatility_state=payload["regimeVolatilityState"],
        versions=versions, snapshot_hash=snapshot_hash,
    )
