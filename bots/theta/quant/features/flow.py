"""FLOW feature (THETA long-run build, work package 09, Phase 2 feature
family: FLOW).

RawFlowObservation -> NormalizedFlowObservation -> FlowWindowAggregate ->
FeatureResult. Uses only provider-supported semantics: if the provider
does not prove aggressor side (buy/sell direction), this module does not
invent one -- `direction` stays `None` and the aggregate honestly reports
how many observations had a known vs unknown direction, rather than
defaulting unknowns into either bucket.
"""

from dataclasses import dataclass
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class RawFlowObservation:
    """Whatever real fields the provider actually supplies for one flow
    print -- `direction` is `None` whenever aggressor side is not proven,
    never guessed from premium/size heuristics this module does not own."""
    option_symbol: str
    underlying_symbol: str
    premium: Optional[float]
    volume: Optional[int]
    option_type: str  # "PUT" or "CALL"
    direction: Optional[str]  # "BUY" | "SELL" | None (provider did not prove it)
    category: Optional[str]  # e.g. "SWEEP" | "BLOCK" | None
    observed_at: str
    retrieved_at: str


@dataclass(frozen=True)
class NormalizedFlowObservation:
    raw: RawFlowObservation
    is_call: bool


def normalize_flow_observation(raw: RawFlowObservation) -> Optional[NormalizedFlowObservation]:
    """Returns `None` (never a fabricated normalized row) when the
    contract-identity field required to classify put/call is itself
    invalid."""
    if raw.option_type not in ("PUT", "CALL"):
        return None
    return NormalizedFlowObservation(raw=raw, is_call=raw.option_type == "CALL")


@dataclass(frozen=True)
class FlowWindowAggregate:
    window_start: str
    window_end: str  # the PIT cutoff -- no observation with observed_at > window_end may be included
    total_premium: float
    total_volume: int
    call_premium: float
    put_premium: float
    known_direction_count: int
    unknown_direction_count: int
    buy_premium: float
    sell_premium: float
    observation_count: int


def aggregate_flow_window(
    observations: Sequence[NormalizedFlowObservation], window_start: str, window_end: str,
) -> FlowWindowAggregate:
    """Aggregates already-normalized flow observations into one window.
    Any observation whose `observed_at` is after `window_end` (a late
    retrieval racing the cutoff) is excluded, never included -- this is
    the PIT cutoff enforcement point for FLOW.
    """
    in_window = [
        observation for observation in observations
        if window_start <= observation.raw.observed_at <= window_end
    ]
    total_premium = sum(observation.raw.premium or 0.0 for observation in in_window)
    total_volume = sum(observation.raw.volume or 0 for observation in in_window)
    call_premium = sum(observation.raw.premium or 0.0 for observation in in_window if observation.is_call)
    put_premium = sum(observation.raw.premium or 0.0 for observation in in_window if not observation.is_call)
    known_direction = [observation for observation in in_window if observation.raw.direction is not None]
    buy_premium = sum(observation.raw.premium or 0.0 for observation in known_direction if observation.raw.direction == "BUY")
    sell_premium = sum(observation.raw.premium or 0.0 for observation in known_direction if observation.raw.direction == "SELL")
    return FlowWindowAggregate(
        window_start=window_start, window_end=window_end, total_premium=total_premium, total_volume=total_volume,
        call_premium=call_premium, put_premium=put_premium, known_direction_count=len(known_direction),
        unknown_direction_count=len(in_window) - len(known_direction), buy_premium=buy_premium,
        sell_premium=sell_premium, observation_count=len(in_window),
    )


def flow_feature_result(
    aggregate: FlowWindowAggregate, underlying_symbol: str, as_of: str, retrieved_at: str,
    min_observations: int = 1, version: str = "flow-window-aggregate-v1",
) -> FeatureResult:
    feature_id = f"FLOW_WINDOW_{underlying_symbol}"
    if aggregate.observation_count < min_observations:
        return FeatureResult(
            feature_id=feature_id, family="FLOW", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_premium", source_provider="OPTIONOMICS", source_operation="aggregate_flow_window",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None,
            coverage=aggregate.observation_count / max(1, min_observations), version=version,
            reason_codes=(f"FLOW_INSUFFICIENT_COVERAGE:{aggregate.observation_count}_of_{min_observations}_required",),
        )
    return FeatureResult(
        feature_id=feature_id, family="FLOW", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={
            "totalPremium": aggregate.total_premium, "totalVolume": aggregate.total_volume,
            "callPremium": aggregate.call_premium, "putPremium": aggregate.put_premium,
            "knownDirectionCount": aggregate.known_direction_count,
            "unknownDirectionCount": aggregate.unknown_direction_count,
            "buyPremium": aggregate.buy_premium, "sellPremium": aggregate.sell_premium,
            "observationCount": aggregate.observation_count,
        },
        units="usd_premium", source_provider="OPTIONOMICS", source_operation="aggregate_flow_window",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("FLOW_OK",),
    )
