"""The complete canonical 20-family feature bundle (THETA long-run build,
work package 20, Phase 2).

Requires EXACTLY one `FeatureResult` per canonical family -- never zero,
never two competing entries for the same family. A family with no
producer wired yet is recorded honestly as an `UNKNOWN_FAMILY` entry
(never silently omitted from the bundle), matching this session's own
`SECTOR`/`FUNDAMENTAL_QUALITY` `BLOCKED_DATA` producers.

The 20 canonical families (master command section 8, verbatim order):
LIQUIDITY, OWNERSHIP, DRAWDOWN_RECOVERY, TREND, MOMENTUM,
REALIZED_VOLATILITY, IV, SKEW, TERM_STRUCTURE, VOLATILITY_SURFACE, FLOW,
UNUSUAL_ACTIVITY, VOLUME_OPEN_INTEREST, EVENT_CONTEXT, SECTOR,
CORRELATION, PORTFOLIO_EXPOSURE, FUNDAMENTAL_QUALITY, REGIME,
EXECUTION_QUALITY.
"""

from dataclasses import dataclass
from typing import Mapping, Sequence

from features.feature_contract import (
    FeatureResult, FeatureResultState, FeatureTruthClass, _canonical_json, _sha256_text,
)

CANONICAL_FAMILIES: Sequence[str] = (
    "LIQUIDITY", "OWNERSHIP", "DRAWDOWN_RECOVERY", "TREND", "MOMENTUM",
    "REALIZED_VOLATILITY", "IV", "SKEW", "TERM_STRUCTURE", "VOLATILITY_SURFACE", "FLOW",
    "UNUSUAL_ACTIVITY", "VOLUME_OPEN_INTEREST", "EVENT_CONTEXT", "SECTOR",
    "CORRELATION", "PORTFOLIO_EXPOSURE", "FUNDAMENTAL_QUALITY", "REGIME",
    "EXECUTION_QUALITY",
)
assert len(CANONICAL_FAMILIES) == 20
assert len(set(CANONICAL_FAMILIES)) == 20  # no accidental duplicate family name


def _unknown_family_result(family: str, underlying_symbol: str, as_of: str, retrieved_at: str) -> FeatureResult:
    return FeatureResult(
        feature_id=f"{family}_{underlying_symbol}_UNWIRED", family=family, state=FeatureResultState.UNKNOWN,
        truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None, units="n/a",
        source_provider="NONE_WIRED", source_operation="feature_bundle_default",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None,
        version="feature-bundle-unwired-default-v1", reason_codes=(f"{family}_NOT_YET_WIRED_INTO_BUNDLE",),
    )


@dataclass(frozen=True)
class FeatureBundle:
    bundle_version: str
    underlying_symbol: str
    decision_timestamp: str
    results: Mapping[str, FeatureResult]  # keyed by family, exactly the 20 canonical families
    content_hash: str
    unknown_families: Sequence[str]
    stale_families: Sequence[str]
    real_families: Sequence[str]  # state==OK and truth_class in {MARKET_OBSERVED, DERIVED_FROM_OBSERVED}


def build_feature_bundle(
    provided_results: Mapping[str, FeatureResult], underlying_symbol: str, decision_timestamp: str,
    retrieved_at: str, bundle_version: str = "feature-bundle-v1",
) -> FeatureBundle:
    """Requires exactly one result per canonical family. A `provided_results`
    key not in `CANONICAL_FAMILIES`, or a `FeatureResult.family` mismatching
    its own dict key, is rejected explicitly -- never silently accepted.
    """
    for family in provided_results:
        if family not in CANONICAL_FAMILIES:
            raise ValueError(f"FEATURE_BUNDLE_UNKNOWN_FAMILY_KEY:{family}")
    for family, result in provided_results.items():
        if result.family != family:
            raise ValueError(f"FEATURE_BUNDLE_FAMILY_MISMATCH:key={family}_result.family={result.family}")

    results = dict(provided_results)
    for family in CANONICAL_FAMILIES:
        if family not in results:
            results[family] = _unknown_family_result(family, underlying_symbol, decision_timestamp, retrieved_at)

    unknown_families = [family for family, result in results.items() if result.state == FeatureResultState.UNKNOWN]
    stale_families = [family for family, result in results.items() if result.state == FeatureResultState.STALE]
    real_families = [
        family for family, result in results.items()
        if result.state == FeatureResultState.OK
        and result.truth_class in (FeatureTruthClass.MARKET_OBSERVED, FeatureTruthClass.DERIVED_FROM_OBSERVED)
    ]

    payload = {
        "bundleVersion": bundle_version, "underlyingSymbol": underlying_symbol,
        "decisionTimestamp": decision_timestamp,
        "results": {family: results[family].to_json_dict() for family in CANONICAL_FAMILIES},
    }
    content_hash = _sha256_text(_canonical_json(payload))
    return FeatureBundle(
        bundle_version=bundle_version, underlying_symbol=underlying_symbol, decision_timestamp=decision_timestamp,
        results=results, content_hash=content_hash,
        unknown_families=tuple(sorted(unknown_families)), stale_families=tuple(sorted(stale_families)),
        real_families=tuple(sorted(real_families)),
    )
