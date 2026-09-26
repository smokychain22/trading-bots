"""LIQUIDITY feature (THETA long-run build, work package 11, Phase 2
feature family: LIQUIDITY).

Consolidates the real fields this repo's provider layer actually supplies
(bid/ask, spread, volume, OI, quote freshness) into one canonical
LIQUIDITY feature. Depth/size-at-level is NOT fabricated when the
provider lacks it -- `depth_available` stays `False` and the structured
value omits a depth field entirely rather than inventing one.
"""

from dataclasses import dataclass
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class LiquidityObservation:
    option_symbol: str
    bid: Optional[float]
    ask: Optional[float]
    volume: Optional[int]
    open_interest: Optional[int]
    quote_age_seconds: Optional[float]
    max_quote_age_seconds: float
    bid_size: Optional[int] = None
    ask_size: Optional[int] = None
    as_of: str = ""
    retrieved_at: str = ""


def liquidity_result(observation: LiquidityObservation, version: str = "liquidity-v1") -> FeatureResult:
    feature_id = f"LIQUIDITY_{observation.option_symbol}"

    if observation.bid is None or observation.ask is None:
        return FeatureResult(
            feature_id=feature_id, family="LIQUIDITY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="ALPACA", source_operation="liquidity_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=observation.quote_age_seconds,
            coverage=None, version=version, reason_codes=("LIQUIDITY_UNKNOWN:missing_bid_or_ask",),
        )
    if observation.bid <= 0.0 and observation.ask <= 0.0:
        return FeatureResult(
            feature_id=feature_id, family="LIQUIDITY", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="ALPACA", source_operation="liquidity_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=observation.quote_age_seconds,
            coverage=None, version=version, reason_codes=("LIQUIDITY_INVALID:zero_bid",),
        )
    if observation.bid > observation.ask:
        return FeatureResult(
            feature_id=feature_id, family="LIQUIDITY", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="ALPACA", source_operation="liquidity_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=observation.quote_age_seconds,
            coverage=None, version=version, reason_codes=(f"LIQUIDITY_INVALID:crossed_quote_bid={observation.bid}_ask={observation.ask}",),
        )
    if observation.quote_age_seconds is not None and observation.quote_age_seconds > observation.max_quote_age_seconds:
        return FeatureResult(
            feature_id=feature_id, family="LIQUIDITY", state=FeatureResultState.STALE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="ALPACA", source_operation="liquidity_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=observation.quote_age_seconds,
            coverage=None, version=version, reason_codes=(f"LIQUIDITY_STALE:{observation.quote_age_seconds}s",),
        )

    mid = (observation.bid + observation.ask) / 2.0
    spread_absolute = observation.ask - observation.bid
    spread_pct = spread_absolute / mid if mid > 0 else None
    depth_available = observation.bid_size is not None and observation.ask_size is not None
    structured_value = {
        "spreadAbsolute": spread_absolute, "spreadPct": spread_pct, "mid": mid,
        "volume": observation.volume, "openInterest": observation.open_interest,
        "depthAvailable": depth_available,
    }
    if depth_available:
        structured_value["bidSize"] = observation.bid_size
        structured_value["askSize"] = observation.ask_size
    return FeatureResult(
        feature_id=feature_id, family="LIQUIDITY", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None, structured_value=structured_value,
        units="usd_and_ratios", source_provider="ALPACA", source_operation="liquidity_result",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=observation.quote_age_seconds,
        coverage=None, version=version, reason_codes=("LIQUIDITY_OK",),
    )
