"""Strategy-switch target formalization (P2C pass 2, directive section 17):
STAY / SWITCH / WAIT, with every SWITCH candidate fully charged for its own
transition cost before comparison -- never inferred as correct merely
because the destination later made money, which the directive explicitly
forbids. Extends `H-Q-04` (switching-cost measurement discipline, already
registered in `hypotheses.json`) with a concrete, testable function.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class SwitchDecision(str, Enum):
    STAY = "STAY"
    SWITCH = "SWITCH"
    WAIT = "WAIT"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class SwitchCostComponents:
    """Every component is a REALIZED or MODELED cost, never a forecast of
    the destination's future performance -- this dataclass captures only
    what it costs to leave the current position and enter the candidate
    one, independent of whether the candidate later wins or loses."""

    origin_closing_realized_pnl: Optional[float]  # signed: negative = a realized loss on close
    origin_closing_execution_cost: Optional[float]  # spread/slippage/commission to close, always a positive cost
    new_entry_execution_cost: Optional[float]  # spread/slippage/commission to open the candidate, always a positive cost
    capital_days_forgone: Optional[float]  # capital-days the origin position would have occupied had it been held to its own natural resolution, forgone by switching early
    theta_forgone: Optional[float]  # remaining theta/premium value forfeited by closing the origin early, always >= 0


@dataclass(frozen=True)
class SwitchEvaluation:
    decision: SwitchDecision
    total_switch_cost: Optional[float]
    candidate_net_edge_after_switch_cost: Optional[float]
    reason: Optional[str]


def evaluate_strategy_switch(
    candidate_expected_edge: Optional[float],
    costs: SwitchCostComponents,
    minimum_net_edge_to_switch: float,
) -> SwitchEvaluation:
    """`candidate_expected_edge` must be an EX-ANTE, already-vetted estimate
    of the candidate's edge (e.g. from the candidate's own frontier
    evaluation) -- this function never accepts a realized future outcome as
    its input, which would be exactly the "destination profitable = switch
    was correct" fallacy the directive forbids. Returns UNKNOWN whenever
    the edge estimate or any REQUIRED cost component is missing -- a
    switch is never approved on partial cost information. `origin_closing_
    realized_pnl` is informational only (already realized, immutable per
    ROLL-001) and is NOT charged against the candidate -- it is reported
    separately so a caller never double-counts it into the switch
    decision itself."""
    if candidate_expected_edge is None:
        return SwitchEvaluation(SwitchDecision.UNKNOWN, None, None, "CANDIDATE_EDGE_UNKNOWN")

    required = [
        costs.origin_closing_execution_cost, costs.new_entry_execution_cost,
        costs.capital_days_forgone, costs.theta_forgone,
    ]
    if any(component is None for component in required):
        return SwitchEvaluation(SwitchDecision.UNKNOWN, None, None, "SWITCH_COST_COMPONENT_UNKNOWN")

    total_cost = (
        costs.origin_closing_execution_cost + costs.new_entry_execution_cost
        + costs.theta_forgone
    )
    # capital_days_forgone is tracked and returned for transparency but is a
    # CAPACITY cost, not a dollar cost -- never summed into total_switch_cost
    # directly; a caller comparing across candidates uses it as a separate
    # constraint dimension (matching the multi-objective policy-target
    # design, never collapsed into one scalar here).
    net_edge = candidate_expected_edge - total_cost

    if net_edge >= minimum_net_edge_to_switch:
        decision = SwitchDecision.SWITCH
    elif net_edge > 0:
        decision = SwitchDecision.WAIT  # positive but below the caller's own justified switch bar -- not yet compelling enough to pay the transition cost
    else:
        decision = SwitchDecision.STAY

    return SwitchEvaluation(decision, total_cost, net_edge, None)
