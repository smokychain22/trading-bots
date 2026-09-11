"""Candidate-funnel strictness diagnostics for THETA (R6E).

Answers the R6E question directly: is THETA disciplined, or is THETA
paralyzed? A funnel that goes from thousands of enumerated contracts to
zero selections every day, broken down honestly by WHICH gate ate the
candidates, is the only way to tell "correctly selective" apart from
"an accumulated 25-condition AND-checklist quietly strangled the
universe" -- both look identical from the outside as "the bot didn't
trade today" unless the funnel itself is inspectable.

No I/O, no provider dependency -- pure aggregation over caller-supplied
counts, exercised only against synthetic fixtures. Entry frequency is
never treated as a target here (R6E item 3) -- this module only measures
what happened and why, never what SHOULD have happened.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass(frozen=True)
class CandidateFunnel:
    """The complete candidate funnel for one research session/cycle. Every
    stage is a count, never a rate computed from a possibly-zero
    denominator upstream -- rates are derived on demand by
    `funnel_ratios`, which handles zero denominators explicitly."""

    universe_count: int
    contracts_enumerated: int
    mechanically_invalid_count: int
    hard_veto_count: int
    soft_rejected_count: int
    ranked_count: int
    positive_ev_count: Optional[int]  # None until empirical EV exists (EV_MODEL_NOT_EMPIRICALLY_READY) -- never fabricated
    risk_feasible_count: int
    selected_count: int
    wait_count: int  # 0 or 1 for a single-decision cycle; a multi-underlying session may report >1


@dataclass(frozen=True)
class RejectionBreakdown:
    """Rejection counts attributed to a specific named gate/reason -- the
    mechanism that lets a caller answer "which gate causes the most missed
    candidates," never just "how many were rejected in total.\""""

    by_gate: Dict[str, int] = field(default_factory=dict)

    def top_gates(self, n: int) -> List[tuple]:
        """The `n` gates responsible for the most rejections, descending --
        the direct answer to "which gate causes the most missed
        opportunity" (R6E item 24's own question list)."""
        return sorted(self.by_gate.items(), key=lambda kv: kv[1], reverse=True)[:n]


@dataclass(frozen=True)
class FunnelRatios:
    hard_veto_rate: Optional[float]  # hard_veto_count / contracts_enumerated
    soft_rejection_rate: Optional[float]  # soft_rejected_count / (contracts_enumerated - mechanically_invalid_count - hard_veto_count)
    selection_rate: Optional[float]  # selected_count / ranked_count
    opportunity_capture_rate: Optional[float]  # selected_count / positive_ev_count -- None whenever positive_ev_count itself is None (never fabricated)


def funnel_ratios(funnel: CandidateFunnel) -> FunnelRatios:
    """Derives rates from a `CandidateFunnel`, returning None (never a
    fabricated 0.0 or a ZeroDivisionError) for any ratio whose denominator
    is zero or whose numerator is genuinely unknown."""
    hard_veto_rate = (
        funnel.hard_veto_count / funnel.contracts_enumerated
        if funnel.contracts_enumerated > 0 else None
    )

    soft_eligible_pool = funnel.contracts_enumerated - funnel.mechanically_invalid_count - funnel.hard_veto_count
    soft_rejection_rate = (
        funnel.soft_rejected_count / soft_eligible_pool
        if soft_eligible_pool > 0 else None
    )

    selection_rate = (
        funnel.selected_count / funnel.ranked_count
        if funnel.ranked_count > 0 else None
    )

    opportunity_capture_rate = (
        funnel.selected_count / funnel.positive_ev_count
        if funnel.positive_ev_count is not None and funnel.positive_ev_count > 0 else None
    )

    return FunnelRatios(
        hard_veto_rate=hard_veto_rate,
        soft_rejection_rate=soft_rejection_rate,
        selection_rate=selection_rate,
        opportunity_capture_rate=opportunity_capture_rate,
    )


def is_funnel_internally_consistent(funnel: CandidateFunnel) -> List[str]:
    """Structural sanity checks a real funnel must satisfy -- catches a
    bookkeeping bug in the counts themselves before anyone tries to
    interpret "the bot is too strict" from numbers that don't even add up.
    Returns a list of violations (empty = consistent)."""
    violations: List[str] = []
    if funnel.contracts_enumerated > funnel.universe_count * 10_000:
        # A generous sanity ceiling, not a real business rule -- catches an
        # obviously wrong join/multiplication bug in the caller's own
        # counting, not a real strictness question.
        violations.append("contracts_enumerated is implausibly large relative to universe_count -- check for a counting bug upstream")
    remaining_after_invalid = funnel.contracts_enumerated - funnel.mechanically_invalid_count
    if remaining_after_invalid < 0:
        violations.append("mechanically_invalid_count exceeds contracts_enumerated")
    remaining_after_hard_veto = remaining_after_invalid - funnel.hard_veto_count
    if remaining_after_hard_veto < 0:
        violations.append("hard_veto_count exceeds the contracts remaining after mechanical-invalidity exclusion")
    remaining_after_soft = remaining_after_hard_veto - funnel.soft_rejected_count
    if remaining_after_soft < 0:
        violations.append("soft_rejected_count exceeds the contracts remaining after hard-veto exclusion")
    if funnel.selected_count > funnel.ranked_count:
        violations.append("selected_count exceeds ranked_count -- cannot select more than were ranked")
    if funnel.positive_ev_count is not None and funnel.selected_count > funnel.positive_ev_count:
        violations.append("selected_count exceeds positive_ev_count -- cannot select more candidates than had positive EV")
    return violations
