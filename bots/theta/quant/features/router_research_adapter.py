"""Router research adapter (THETA long-run build, work package 22, Phase
2): feature bundle + broker-supplied ownership/portfolio state fixture ->
`models/strategy_router.py`'s real `MarketContext`/`PortfolioContext`
inputs.

`route_strategies()` (the real, existing, canonical router -- NOT
reimplemented here, and this module implements NO final selection of its
own, per work package 22's explicit instruction) decides strategy
eligibility; this adapter's only job is building its two typed input
objects from this session's `FeatureBundle` plus caller-supplied broker
state. `ownership_acceptable` is NOT derived here -- `models/ownership_v0.py`
already owns that computation as its own real producer, out of this
adapter's scope; it is accepted as an explicit parameter until a future
package wires that adapter too (naming this gap explicitly rather than
silently defaulting it).
"""

from dataclasses import dataclass
from typing import Optional

from features.feature_bundle import FeatureBundle
from features.feature_contract import FeatureResultState
from models.strategy_router import LifecycleState, MarketContext, PortfolioContext


@dataclass(frozen=True)
class BrokerConfirmedPortfolioState:
    """The broker-confirmed fixture work package 22 asks for -- application
    layer owns fetching these real values; this adapter never infers them."""
    lifecycle_state: LifecycleState
    stock_shares_held: float
    open_option_exists: bool
    assignment_imminent: bool


def market_context_from_bundle(
    bundle: FeatureBundle, ownership_acceptable: Optional[float], event_near_horizon_days: float = 5.0,
) -> MarketContext:
    liquidity_result = bundle.results.get("LIQUIDITY")
    liquidity_acceptable: Optional[bool] = None
    if liquidity_result is not None and liquidity_result.state == FeatureResultState.OK and liquidity_result.structured_value is not None:
        spread_pct = liquidity_result.structured_value.get("spreadPct")
        liquidity_acceptable = spread_pct is not None and spread_pct < 0.10  # research default, not a promoted threshold

    event_result = bundle.results.get("EVENT_CONTEXT")
    event_near: Optional[bool] = None
    if event_result is not None and event_result.state == FeatureResultState.OK and event_result.structured_value is not None:
        distance_days = event_result.structured_value.get("distanceDays")
        event_near = distance_days is not None and 0 <= distance_days <= event_near_horizon_days
    elif event_result is not None and event_result.state == FeatureResultState.UNKNOWN:
        event_near = None  # no known event is UNKNOWN about proximity, not "no event near"

    # Critical-data validity: real quotes (LIQUIDITY) and real IV data must
    # both be present/valid, matching route_strategies()'s own Layer 0 gate
    # semantics -- an UNKNOWN/INVALID/STALE critical feature fails closed.
    critical_families = ("LIQUIDITY", "IV")
    critical_data_valid = all(
        bundle.results.get(family) is not None and bundle.results[family].state == FeatureResultState.OK
        for family in critical_families
    )

    return MarketContext(
        ownership_acceptable=ownership_acceptable, liquidity_acceptable=liquidity_acceptable,
        event_near=event_near, critical_data_valid=critical_data_valid,
    )


def portfolio_context_from_broker_state(state: BrokerConfirmedPortfolioState) -> PortfolioContext:
    return PortfolioContext(
        lifecycle_state=state.lifecycle_state, stock_shares_held=state.stock_shares_held,
        open_option_exists=state.open_option_exists, assignment_imminent=state.assignment_imminent,
    )
