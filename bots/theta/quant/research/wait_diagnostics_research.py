"""Formal WAIT diagnostics: closes the "WAIT_RESEARCH = GAPS" item carried
across two prior sessions' final receipts.

THETA's own canonical-strategy-frontier.ts already earns GLOBAL_WAIT only
after every applicable branch is actually evaluated (verified in an earlier
session; `globalWaitEarned` requires `blockedApplicable.length === 0`). What
was missing was a formal, testable CLASSIFICATION of *why* a given WAIT
happened -- healthy selectivity, a genuine data/quote/liquidity/portfolio
constraint, or a sign of overstrict policy / possible logic paralysis -- and
a defensible, lookahead-safe methodology for eventually labeling a WAIT as a
CORRECT_REJECT or FALSE_REJECT once real outcomes exist.

This module is pure classification/labeling logic. It does not decide
whether to WAIT (that remains canonical-strategy-frontier.ts's job) and it
never fabricates a future outcome -- every FALSE_REJECT/CORRECT_REJECT
classification requires a caller-supplied, already-resolved outcome; with
none supplied, the result is honestly UNKNOWN, never guessed.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Sequence


class WaitKind(str, Enum):
    """The ten WAIT categories this directive asks to formalize. Mutually
    intended to be exhaustive of "why nothing traded this cycle" -- a
    classifier that cannot place a WAIT into one of these should report
    UNKNOWN_WAIT_KIND rather than force a guess (see classify_wait)."""

    HEALTHY_WAIT = "HEALTHY_WAIT"  # every branch evaluated; nothing cleared its own bar
    NO_OPPORTUNITY = "NO_OPPORTUNITY"  # candidate universe enumerated; zero candidates survived structural filters
    RISK_WAIT = "RISK_WAIT"  # AEGIS/portfolio risk state blocked otherwise-feasible candidates
    DATA_WAIT = "DATA_WAIT"  # required provider data (chain, Optionomics context) was UNKNOWN/unavailable
    QUOTE_WAIT = "QUOTE_WAIT"  # a qualified quote was required and unavailable/stale/crossed
    EVENT_WAIT = "EVENT_WAIT"  # event proximity (earnings/macro) hard-blocked or soft-demoted every candidate
    LIQUIDITY_WAIT = "LIQUIDITY_WAIT"  # candidates existed but failed liquidity policy (spread/size/OI/volume)
    PORTFOLIO_WAIT = "PORTFOLIO_WAIT"  # concentration/correlation/capacity constraints, not the candidate's own economics
    OVERSTRICT_POLICY_WAIT = "OVERSTRICT_POLICY_WAIT"  # a research policy threshold (not a hard safety gate) rejected candidates whose neighbors passed
    POSSIBLE_LOGIC_PARALYSIS = "POSSIBLE_LOGIC_PARALYSIS"  # consecutive-WAIT streak exceeds a caller-justified bound with no structural blocker explaining it
    UNKNOWN_WAIT_KIND = "UNKNOWN_WAIT_KIND"  # the funnel evidence does not cleanly fit any of the above


@dataclass(frozen=True)
class WaitCycleFunnel:
    """The funnel evidence one WAIT cycle must carry to be classifiable at
    all -- mirrors canonical-strategy-frontier.ts's own per-branch funnel
    (candidates_enumerated/hard_rejects/soft_demotions/blockedApplicable)
    rather than inventing a parallel shape. Every count defaults to None
    (UNKNOWN), never 0, when the caller genuinely doesn't have the number."""

    branches_applicable: int
    branches_evaluated: int  # canonical-strategy-frontier.ts's own globalWaitEarned requirement
    candidates_enumerated: Optional[int]
    candidates_data_blocked: Optional[int]  # blocked specifically on UNKNOWN provider/chain data
    candidates_quote_blocked: Optional[int]  # blocked specifically on quote qualification
    candidates_event_blocked: Optional[int]
    candidates_liquidity_blocked: Optional[int]
    candidates_portfolio_blocked: Optional[int]  # AEGIS/concentration/capacity
    candidates_soft_policy_rejected: Optional[int]  # rejected by a tunable research threshold, not a hard gate
    neighboring_cell_passed: Optional[bool]  # did an adjacent DTE/delta cell clear its own bar this same cycle?
    consecutive_wait_cycles: Optional[int]
    consecutive_wait_bound: Optional[int]  # caller-justified; this module never hardcodes one


def classify_wait(funnel: WaitCycleFunnel) -> WaitKind:
    """Deterministic, priority-ordered classification. Order matters: a
    structural safety reason (data/quote/event/liquidity/portfolio) always
    takes priority over the softer OVERSTRICT_POLICY_WAIT / paralysis
    classifications, so a genuinely blocked cycle is never mislabeled as
    "the policy was too strict" merely because a soft-reject count also
    happened to be nonzero in the same cycle."""
    if funnel.branches_evaluated < funnel.branches_applicable:
        return WaitKind.UNKNOWN_WAIT_KIND  # GLOBAL_WAIT itself would not be earned here -- not this module's call to make
    if funnel.candidates_enumerated is None:
        return WaitKind.UNKNOWN_WAIT_KIND
    if funnel.candidates_enumerated == 0:
        return WaitKind.NO_OPPORTUNITY
    if (funnel.candidates_data_blocked or 0) > 0 and funnel.candidates_data_blocked == funnel.candidates_enumerated:
        return WaitKind.DATA_WAIT
    if (funnel.candidates_quote_blocked or 0) > 0 and funnel.candidates_quote_blocked == funnel.candidates_enumerated:
        return WaitKind.QUOTE_WAIT
    if (funnel.candidates_event_blocked or 0) > 0 and funnel.candidates_event_blocked == funnel.candidates_enumerated:
        return WaitKind.EVENT_WAIT
    if (funnel.candidates_liquidity_blocked or 0) > 0 and funnel.candidates_liquidity_blocked == funnel.candidates_enumerated:
        return WaitKind.LIQUIDITY_WAIT
    if (funnel.candidates_portfolio_blocked or 0) > 0 and funnel.candidates_portfolio_blocked == funnel.candidates_enumerated:
        return WaitKind.PORTFOLIO_WAIT
    if funnel.neighboring_cell_passed is True and (funnel.candidates_soft_policy_rejected or 0) > 0:
        return WaitKind.OVERSTRICT_POLICY_WAIT
    if (
        funnel.consecutive_wait_cycles is not None
        and funnel.consecutive_wait_bound is not None
        and funnel.consecutive_wait_cycles > funnel.consecutive_wait_bound
    ):
        return WaitKind.POSSIBLE_LOGIC_PARALYSIS
    return WaitKind.HEALTHY_WAIT


class RejectOutcomeState(str, Enum):
    CORRECT_REJECT = "CORRECT_REJECT"
    FALSE_REJECT = "FALSE_REJECT"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class RejectedCandidateOutcome:
    """A single rejected candidate's later-resolved forward economics --
    supplied by the CALLER from an already-completed, PIT-safe evaluation
    window. This module never computes a future value itself (see
    `evaluate_false_reject` docstring for why WR alone is not the test)."""

    candidate_id: str
    reject_reason: str
    would_have_realized_net_pnl: Optional[float]  # after-cost, whole managed-episode -- None if genuinely unresolved/censored
    would_have_required_tail_exposure: Optional[float]  # e.g. max loss / ES-style estimate at entry, not realized
    would_have_locked_capital_days: Optional[float]
    execution_would_have_been_feasible: Optional[bool]  # a fill assumption is itself an assumption -- see caution below


def evaluate_false_reject(
    outcome: RejectedCandidateOutcome,
    minimum_tail_adjusted_edge: float,
) -> RejectOutcomeState:
    """A rejected candidate that would merely have made money is NOT
    automatically a FALSE_REJECT -- the directive's own section 4 explicitly
    forbids that reduction. This function requires the net outcome to clear
    a caller-justified `minimum_tail_adjusted_edge` (never a hardcoded
    default) AND requires the fill to have been genuinely feasible (never
    assumed) before calling it FALSE_REJECT. Any missing input -- including
    a censored/never-resolved outcome -- returns UNKNOWN, never guessed
    either way.

    CAUTION carried structurally, not just in this docstring:
    `execution_would_have_been_feasible` is itself an ASSUMPTION about a
    trade that never happened -- a neighboring contract's later midpoint is
    not proof a fill was achievable at that price (see the counterfactual-
    caution research this pass also formalizes). Callers should derive this
    field from a MODELED_EXECUTION_OUTCOME (spread-aware, liquidity-aware),
    never a bare MARKET_OUTCOME reference price.
    """
    if (
        outcome.would_have_realized_net_pnl is None
        or outcome.would_have_required_tail_exposure is None
        or outcome.execution_would_have_been_feasible is None
    ):
        return RejectOutcomeState.UNKNOWN
    if not outcome.execution_would_have_been_feasible:
        return RejectOutcomeState.CORRECT_REJECT  # the rejection correctly avoided an unfillable trade, regardless of its theoretical P&L
    tail_adjusted_edge = outcome.would_have_realized_net_pnl - outcome.would_have_required_tail_exposure
    if tail_adjusted_edge >= minimum_tail_adjusted_edge:
        return RejectOutcomeState.FALSE_REJECT
    return RejectOutcomeState.CORRECT_REJECT


def wait_kind_distribution(kinds: Sequence[WaitKind]) -> "dict[WaitKind, int]":
    """A purely descriptive tally -- e.g. for a research report showing how
    many cycles fell into each WAIT category over a period. Never itself a
    verdict on whether the WAIT rate is healthy; that judgment requires the
    false-reject-rate analysis above, run against real resolved outcomes."""
    counts: "dict[WaitKind, int]" = {kind: 0 for kind in WaitKind}
    for kind in kinds:
        counts[kind] += 1
    return counts
