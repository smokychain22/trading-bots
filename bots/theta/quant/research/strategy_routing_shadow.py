"""Strategy-routing shadow record and gate-regret research contracts (R6E).

Implements, as real Python dataclasses for the first time, the metrics
`docs/quant/phase6_router/STRATEGY_ROUTING_SHADOW_RECORD.md` already
SPECIFIED but marked "no code implements this" (StrategySelectionRegret,
RouteRegret, MissedStrategyOpportunity, BadStrategyActivation), plus the
gate-regret shape R6E item 16 requests, built to extend
`src/theta/shadow-opportunity-book.ts`'s existing per-candidate shadow
record rather than duplicate it.

Every metric below is BLOCKED_ON_DATA -- none can be computed without a
real historical dataset and a working backtester/replay engine. This
module exists so R2's persistence schema and R6's eventual empirical
engine have an exact target shape, per the shadow-record spec's own stated
purpose, extended into runnable Python research code (dataclasses +
classification helpers) rather than left as prose alone.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from models.strategy_router import StrategyFamily


@dataclass(frozen=True)
class FamilyCandidateEconomics:
    """One family's single best candidate's economics at a routing
    decision timestamp -- the per-family breakdown the shadow record spec
    requires so "was the runner-up family's best candidate actually better
    after the fact" is answerable."""

    strategy_family: StrategyFamily
    ev_net: Optional[float]
    tail_adjusted_ev: Optional[float]
    return_per_capital_day: Optional[float]
    capital_required: Optional[float]
    uncertainty: Optional[float]


@dataclass(frozen=True)
class StrategyRoutingShadowRecord:
    """One routing decision's full shadow record, per
    STRATEGY_ROUTING_SHADOW_RECORD.md's "what must be persisted per routing
    decision" section."""

    decision_timestamp: str
    eligible_strategy_families: Dict[StrategyFamily, bool]  # every family's eligibility this cycle, not just the winner
    selected_strategy_family: Optional[StrategyFamily]  # None if the decision was a global WAIT
    best_candidate_each_family: Dict[StrategyFamily, FamilyCandidateEconomics]
    later_reconstructable_outcome_known: bool = False  # mirrors ShadowOpportunityEntry.eventualOutcomeKnown -- False until an empirical engine can reconstruct it


@dataclass(frozen=True)
class StrategySelectionRegret:
    """The difference between the selected family's realized/reconstructed
    outcome and the best ELIGIBLE alternative family's candidate's outcome,
    holding the decision timestamp fixed. `regret` is None (BLOCKED_ON_DATA)
    until both outcomes are reconstructable -- never estimated from
    unrealized economics."""

    decision_timestamp: str
    selected_family: StrategyFamily
    best_eligible_alternative_family: Optional[StrategyFamily]
    regret: Optional[float]  # selected_outcome - best_alternative_outcome; negative = selected family underperformed the best alternative
    status: str = "BLOCKED_ON_DATA"


@dataclass(frozen=True)
class RouteRegret:
    """The broader question: was the ROUTING ITSELF wrong (a family that
    should have been eligible was excluded by an overly strict Layer-1/
    Layer-3 gate)? Requires a counterfactual re-run of the router with a
    relaxed gate against real historical state -- genuinely harder than
    StrategySelectionRegret, and explicitly BLOCKED_ON_DATA, never
    approximated from a synthetic counterfactual."""

    decision_timestamp: str
    excluding_gate: str  # which eligibility gate excluded the family in question
    excluded_family: StrategyFamily
    counterfactual_outcome: Optional[float]
    status: str = "BLOCKED_ON_DATA"


@dataclass(frozen=True)
class MissedStrategyOpportunity:
    """A family was ineligible, but its never-generated candidate would
    very likely have been strongly positive-EV. Requires retrospectively
    re-running the ineligible family's candidate generation against the
    same historical state -- exactly the "pretend empirical experiment
    without the required historical data" this repository's discipline
    prohibits until real data and a backtester exist. Always
    BLOCKED_ON_DATA; this dataclass exists only to fix the shape."""

    decision_timestamp: str
    ineligible_family: StrategyFamily
    ineligibility_reason: str
    reconstructed_candidate_ev: Optional[float]
    status: str = "BLOCKED_ON_DATA"


@dataclass(frozen=True)
class GateRegretRecord:
    """R6E item 16/the shadow record's soft-gate regret extension: for one
    soft-rejected candidate, its counterfactual after-cost economics had it
    NOT been rejected. `false_reject` is True only once
    `counterfactual_ev` is known and positive (a real, reconstructed
    outcome) -- never inferred from the candidate's own pre-rejection score."""

    rejecting_gate: str
    candidate_id: str
    counterfactual_ev: Optional[float]
    counterfactual_tail_risk: Optional[float]
    status: str = "BLOCKED_ON_DATA"

    @property
    def false_reject(self) -> Optional[bool]:
        if self.counterfactual_ev is None:
            return None
        return self.counterfactual_ev > 0


@dataclass(frozen=True)
class GateRegretSummary:
    """Aggregates `GateRegretRecord`s by gate -- the direct answer to
    "which soft gates cause the most missed opportunity" vs. "which
    correctly avoid losses" (R6E item 16's own question pair)."""

    records: List[GateRegretRecord] = field(default_factory=list)

    def false_reject_count_by_gate(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for record in self.records:
            if record.false_reject is True:
                counts[record.rejecting_gate] = counts.get(record.rejecting_gate, 0) + 1
        return counts

    def correctly_rejected_count_by_gate(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for record in self.records:
            if record.false_reject is False:
                counts[record.rejecting_gate] = counts.get(record.rejecting_gate, 0) + 1
        return counts

    def unknown_count_by_gate(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for record in self.records:
            if record.false_reject is None:
                counts[record.rejecting_gate] = counts.get(record.rejecting_gate, 0) + 1
        return counts
