"""Feature definitions registry (THETA long-run build, work package 21,
Phase 2).

One entry per (family, version) actually implemented this session --
every producer's own `version=` default string, registered here exactly
once, so a `FeatureResult` claiming a version absent from this registry
is rejected BY `assert_registered_version`. Enforcement status: that check
runs in tests/quant/test_feature_definitions_registry.py against every
producer, NOT inside FeatureResult construction or the deployed runtime, so
it guards the research/build path only. Consumers named below are research
or test callers unless stated otherwise; the deployed runtime computes its
production features in TypeScript (golden-vector locked), not through this
package.
"""

from dataclasses import dataclass
from typing import Mapping, Tuple


@dataclass(frozen=True)
class FeatureDefinition:
    definition_id: str
    family: str
    version: str
    units: str
    source: str
    pit_semantics: str
    freshness_policy: str
    calculation: str
    consumer: str
    truth_classification: str


_REGISTRY_ENTRIES: Tuple[FeatureDefinition, ...] = (
    FeatureDefinition("TREND_MA_SLOPE", "TREND", "trend-ma-slope-v1", "fractional_change_per_window",
        "internal bar series", "reads only closes[:as_of_index+1]", "STALE if bars_since_last > policy",
        "trailing MA slope between two windows", "regime_adapter.py (research/test only; not on the deployed path)", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("MOMENTUM_HORIZON_RETURN", "MOMENTUM", "momentum-horizon-return-v1", "fractional_return",
        "internal bar series", "reads only closes[:as_of_index+1]", "STALE if bars_since_last > policy",
        "simple return over N bars", "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("REALIZED_VOL_CLOSE_TO_CLOSE", "REALIZED_VOLATILITY", "realized-vol-close-to-close-v1",
        "annualized_stdev", "internal bar series", "windowed slice ending at as_of_index",
        "STALE if bars_since_last > policy", "annualized close-to-close sample stdev",
        "regime_adapter.py (research/test only; not on the deployed path)", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("IV_PROVIDER_OBSERVED", "IV", "iv-provider-observed-v1", "implied_volatility_annualized",
        "OPTIONOMICS", "as_of vs provider_timestamp", "STALE if age exceeds max_quote_age_seconds",
        "passthrough of real provider IV", "skew.py, term_structure.py, volatility_surface.py (research only)", "MARKET_OBSERVED"),
    FeatureDefinition("SKEW_RISK_REVERSAL_25D", "SKEW", "skew-risk-reversal-25d-v1", "iv_difference",
        "internal derived from iv.py", "same-expiry, per-observation IV freshness upstream", "n/a (composes upstream staleness)",
        "call IV - put IV at 25-delta", "none yet", "DERIVED_FROM_OBSERVED (RESEARCH_BASELINE classification, see skew.py)"),
    FeatureDefinition("TERM_STRUCTURE_ATM_IV", "TERM_STRUCTURE", "term-structure-atm-iv-v1", "iv_by_dte_curve",
        "internal derived from iv.py", "per-expiry IV freshness upstream", "n/a (composes upstream staleness)",
        "DTE-ordered ATM IV curve, no interpolation", "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("VOLATILITY_SURFACE_GRID", "VOLATILITY_SURFACE", "volatility-surface-grid-v1", "iv_grid",
        "internal derived from iv.py", "per-cell IV freshness upstream", "n/a (composes upstream staleness)",
        "expiry x delta-bucket IV grid, observed/missing cells", "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("VOLUME_OI", "VOLUME_OPEN_INTEREST", "volume-oi-v1", "contracts", "ALPACA",
        "as_of vs oi_age_seconds", "STALE if oi age exceeds policy", "separated volume/OI passthrough + ratio",
        "none yet", "MARKET_OBSERVED"),
    FeatureDefinition("FLOW_WINDOW_AGGREGATE", "FLOW", "flow-window-aggregate-v1", "usd_premium", "OPTIONOMICS",
        "window_start/window_end cutoff on observed_at", "n/a (windowed, not point-in-time staleness)",
        "premium/volume aggregation with known/unknown direction split", "none yet", "MARKET_OBSERVED"),
    FeatureDefinition("UOA_ROBUST_Z", "UNUSUAL_ACTIVITY", "uoa-robust-z-v1", "robust_z_score",
        "internal derived (current metric + baseline)", "caller-supplied PIT-filtered baseline window",
        "n/a (statistical, not time-based)", "median+MAD robust z-score vs baseline", "none yet",
        "DERIVED_FROM_OBSERVED or MODELED_RESEARCH if event context ambiguous"),
    FeatureDefinition("LIQUIDITY", "LIQUIDITY", "liquidity-v1", "usd_and_ratios", "ALPACA",
        "as_of vs quote_age_seconds", "STALE if quote age exceeds policy", "bid/ask/spread/volume/OI consolidation",
        "none yet", "MARKET_OBSERVED"),
    FeatureDefinition("EVENT_CONTEXT", "EVENT_CONTEXT", "event-context-v1", "days_to_event", "caller-declared source",
        "known_at must be <= as_of (rejected otherwise)", "n/a (event proximity, not point staleness)",
        "distance-to-scheduled-event classification", "none yet", "MARKET_OBSERVED"),
    FeatureDefinition("SECTOR", "SECTOR", "sector-v1", "sector_code", "NONE_AUTHORIZED (BLOCKED_DATA)",
        "n/a", "n/a", "passthrough of an authorized sector classification (none exists yet)",
        "none yet", "UNKNOWN until a real provider is wired (CODEX_HANDOFF_WP13)"),
    FeatureDefinition("CORRELATION_PEARSON", "CORRELATION", "correlation-pearson-v1", "pearson_r",
        "internal derived from two return series", "windowed slice ending at as_of_index",
        "STALE if bars_since_last > policy", "rolling Pearson correlation, undefined for constant series",
        "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("PORTFOLIO_EXPOSURE", "PORTFOLIO_EXPOSURE", "portfolio-exposure-v1", "usd_and_ratios",
        "APPLICATION_BROKER_CONFIRMED", "caller-supplied broker-confirmed positions only", "n/a",
        "gross/net/sector/underlying exposure arithmetic", "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("FUNDAMENTAL_QUALITY", "FUNDAMENTAL_QUALITY", "fundamental-quality-v1", "provider_defined",
        "NONE_AUTHORIZED (BLOCKED_DATA)", "n/a", "n/a", "passthrough of an authorized fundamental metric (none exists yet)",
        "none yet", "UNKNOWN until a real provider is wired (CODEX_HANDOFF_WP17)"),
    FeatureDefinition("DRAWDOWN_RECOVERY", "DRAWDOWN_RECOVERY", "drawdown-recovery-v1", "usd_and_pct",
        "APPLICATION_BROKER_CONFIRMED", "reads only equity_curve[:as_of_index+1]", "STALE if bars_since_last > policy",
        "high-water-mark drawdown/recovery tracking", "none yet", "DERIVED_FROM_OBSERVED"),
    FeatureDefinition("EXECUTION_QUALITY_HEURISTIC", "EXECUTION_QUALITY", "execution-quality-heuristic-v1",
        "usd_and_probability", "internal heuristic (models/execution_quality.py, pre-existing)",
        "n/a (point-in-time quote-based, not windowed)", "policy-bounded quote-age/spread checks",
        "fill-probability/slippage heuristic, never a real fill", "none yet", "MODELED_RESEARCH"),
    # OWNERSHIP and REGIME already have their own pre-existing canonical
    # producers (ownership_v0.py, regime_v0.py) predating this session's
    # work -- registered here for bundle completeness, not re-derived.
    FeatureDefinition("OWNERSHIP_V0", "OWNERSHIP", "pre-existing", "ownership_score", "internal derived",
        "pre-existing module's own PIT contract", "pre-existing module's own freshness policy",
        "see models/ownership_v0.py", "src/theta/canonical-strategy-frontier.ts (app layer)", "pre-existing"),
    FeatureDefinition("REGIME_V0", "REGIME", "pre-existing", "regime_axes", "internal derived",
        "pre-existing module's own PIT contract", "pre-existing module's own freshness policy",
        "see models/regime_v0.py, now fed by regime_adapter.py", "app layer + this session's regime_adapter.py",
        "pre-existing"),
)

# Keyed by (family, version) -- the exact tuple a FeatureResult claims.
FEATURE_DEFINITIONS_REGISTRY: Mapping[Tuple[str, str], FeatureDefinition] = {
    (entry.family, entry.version): entry for entry in _REGISTRY_ENTRIES
}


def is_registered_version(family: str, version: str) -> bool:
    return (family, version) in FEATURE_DEFINITIONS_REGISTRY


def assert_registered_version(family: str, version: str) -> None:
    """The enforcement point work package 21 requires: a FeatureResult
    cannot claim a version absent from this registry."""
    if not is_registered_version(family, version):
        raise ValueError(f"FEATURE_VERSION_NOT_REGISTERED:family={family}:version={version}")
