"""THETA contextual strategy router.

Solves the specific failure mode this module exists to prevent: treating
every strategy family as an independent yes/no voter ("ownership says yes,
trend says no, expert A says yes... -> WAIT") produces paralysis, because
profitable approaches frequently apply in DIFFERENT states, not all states
simultaneously. The fix is not consensus -- it's routing: determine which
strategy family is even eligible to act given the current lifecycle and
market state, and only let eligible families' candidates compete
economically (that competition itself happens in
opportunity_frontier.py/management_action_value.py, not here).

This module is Layer 1 + Layer 3 of the routing hierarchy this task
specifies (portfolio/lifecycle state, then strategy eligibility). It does
NOT generate candidates, compute economics, or decide the final action --
those remain theta_q_baseline.py/theta_q_lattice.py/opportunity_frontier.py/
management_action_value.py's jobs. This module answers one question only:
"given what we currently own and what the market looks like, which THETA
branches may sensibly compete right now?"
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from models.common import ReasonCode


class StrategyFamily(str, Enum):
    THETA_Q = "THETA_Q"  # conventional ownership-aware premium harvesting
    THETA_H = "THETA_H"  # short-DTE hold-the-strike challenger
    THETA_R = "THETA_R"  # roll/management intelligence -- existing option exposure only
    THETA_A = "THETA_A"  # assignment/recovery -- assignment risk or stock ownership only
    THETA_C = "THETA_C"  # covered-call monetization -- confirmed stock inventory only
    THETA_D = "THETA_D"  # defined-risk challenger -- gated, THETA-Q alternative only


class LifecycleState(str, Enum):
    CASH_AVAILABLE = "CASH_AVAILABLE"
    CSP_OPEN = "CSP_OPEN"
    ASSIGNMENT_RISK = "ASSIGNMENT_RISK"
    STOCK_HELD = "STOCK_HELD"
    RECOVERY = "RECOVERY"
    CC_OPEN = "CC_OPEN"
    ROLL_PENDING = "ROLL_PENDING"
    ORDER_PENDING = "ORDER_PENDING"
    UNKNOWN_SUBMISSION = "UNKNOWN_SUBMISSION"


class EligibilityState(str, Enum):
    ELIGIBLE_PRIMARY = "ELIGIBLE_PRIMARY"
    ELIGIBLE_CHALLENGER = "ELIGIBLE_CHALLENGER"
    ELIGIBLE_REDUCED = "ELIGIBLE_REDUCED"
    INELIGIBLE_STATE = "INELIGIBLE_STATE"
    INELIGIBLE_RISK = "INELIGIBLE_RISK"
    INELIGIBLE_DATA = "INELIGIBLE_DATA"
    INELIGIBLE_STRUCTURE = "INELIGIBLE_STRUCTURE"
    PASS = "PASS"


_ELIGIBLE_STATES = frozenset({
    EligibilityState.ELIGIBLE_PRIMARY,
    EligibilityState.ELIGIBLE_CHALLENGER,
    EligibilityState.ELIGIBLE_REDUCED,
})


class ModelDisagreementState(str, Enum):
    """Layer 5/20's disagreement classification -- disagreement among
    upstream models (ownership/regime/expert-prior) is never automatically
    coerced into WAIT; it's classified so the caller can decide size/
    structure/action accordingly (see this module's own docstring and
    docs/quant/phase5_management/ for the full anti-paralysis discipline)."""

    NO_EDGE = "NO_EDGE"
    UNCERTAIN_EDGE = "UNCERTAIN_EDGE"
    POSITIVE_EDGE_LOW_CONFIDENCE = "POSITIVE_EDGE_LOW_CONFIDENCE"
    POSITIVE_EDGE_STRONG_CONFIDENCE = "POSITIVE_EDGE_STRONG_CONFIDENCE"
    DATA_INVALID = "DATA_INVALID"
    RISK_VETO = "RISK_VETO"


@dataclass(frozen=True)
class RouterPolicy:
    """Every floor below is a REQUIRED, versioned research/default policy
    parameter -- there is no built-in default, and none of these numbers is
    asserted to be production-optimal. They exist so the router is testable
    and so THETA-H's "stricter than THETA-Q" requirement is structurally
    enforceable (two different floors over the same continuous score), not
    because any specific floor value has been empirically validated. Per
    TRD section 51 (risk/research parameters are versioned configuration),
    a real value belongs in a versioned policy record once one exists --
    this dataclass only fixes the SHAPE of that record.
    """

    policy_version: str
    theta_q_min_ownership_acceptability: float
    theta_h_min_ownership_acceptability: float  # THETA-H's cohort validation bar is stricter than THETA-Q's
    theta_d_gate_satisfied: bool  # Level 3 options approval + THETA-Q/H/R/C/A graduation, per strategy_archetypes.json


@dataclass(frozen=True)
class MarketContext:
    """Layer 2 inputs -- already-computed regime axes (regime_v0.py), never
    re-derived here. None means UNKNOWN, not assumed acceptable.
    ``ownership_acceptable`` is the continuous ownership_v0.py-style score
    in [0, 1], not a boolean -- THETA-Q and THETA-H apply different floors
    to the SAME score, per THETA-H's stricter-cohort requirement."""

    ownership_acceptable: Optional[float]
    liquidity_acceptable: Optional[bool]
    event_near: bool
    critical_data_valid: bool  # quotes/contracts/timestamps/broker/portfolio/positions all sane


@dataclass(frozen=True)
class PortfolioContext:
    """Layer 1 inputs -- what we actually own, for the specific
    underlying/chain this routing decision concerns."""

    lifecycle_state: LifecycleState
    stock_shares_held: float
    open_option_exists: bool
    assignment_imminent: bool


@dataclass(frozen=True)
class StrategyEligibilityResult:
    strategy_family: StrategyFamily
    eligible: bool
    eligibility_state: EligibilityState
    reasons: List[ReasonCode]
    policy_version: str


def _ineligible(family: StrategyFamily, state: EligibilityState, code: str, detail: str, policy: RouterPolicy) -> StrategyEligibilityResult:
    return StrategyEligibilityResult(
        strategy_family=family, eligible=False, eligibility_state=state,
        reasons=[ReasonCode(code, -1, detail)], policy_version=policy.policy_version,
    )


def _eligible(family: StrategyFamily, state: EligibilityState, code: str, detail: str, policy: RouterPolicy) -> StrategyEligibilityResult:
    return StrategyEligibilityResult(
        strategy_family=family, eligible=True, eligibility_state=state,
        reasons=[ReasonCode(code, 1, detail)], policy_version=policy.policy_version,
    )


def route_strategies(
    policy: RouterPolicy, portfolio: PortfolioContext, market: MarketContext
) -> List[StrategyEligibilityResult]:
    """Determines which strategy families may compete, given the current
    lifecycle and market state. This is NOT a vote -- an ineligible family
    is simply excluded from candidate generation for this cycle; it is not
    counted as a "no" that pushes the account toward WAIT. Every family
    still gets a result (even when ineligible) so the shadow record can
    show why a branch didn't compete, not just that it didn't.
    """
    results: List[StrategyEligibilityResult] = []

    if not market.critical_data_valid:
        # LAYER 0: invalid critical data is a hard, blanket exclusion --
        # applies identically to every family, since no branch can safely
        # act on data it can't trust.
        return [
            _ineligible(family, EligibilityState.INELIGIBLE_DATA, "CRITICAL_DATA_INVALID",
                        "Quotes/contracts/timestamps/broker/portfolio state failed validity checks.", policy)
            for family in StrategyFamily
        ]

    # LAYER 1: lifecycle state determines which families are even relevant.
    lifecycle = portfolio.lifecycle_state

    # THETA-R: only relevant to an existing option position, and only while
    # it's genuinely open or mid-roll -- never competes for a brand-new entry.
    if lifecycle in (LifecycleState.CSP_OPEN, LifecycleState.ROLL_PENDING, LifecycleState.CC_OPEN):
        results.append(_eligible(StrategyFamily.THETA_R, EligibilityState.ELIGIBLE_PRIMARY,
                                  "EXISTING_OPTION_EXPOSURE", f"lifecycle_state={lifecycle.value}", policy))
    else:
        results.append(_ineligible(StrategyFamily.THETA_R, EligibilityState.INELIGIBLE_STATE,
                                    "NO_OPEN_OPTION_EXPOSURE", "No existing option leg to manage.", policy))

    # THETA-A: only relevant when assignment risk is present or stock is
    # already held from a prior assignment.
    if lifecycle in (LifecycleState.ASSIGNMENT_RISK, LifecycleState.STOCK_HELD, LifecycleState.RECOVERY) or portfolio.assignment_imminent:
        results.append(_eligible(StrategyFamily.THETA_A, EligibilityState.ELIGIBLE_PRIMARY,
                                  "ASSIGNMENT_OR_STOCK_PRESENT", f"lifecycle_state={lifecycle.value}", policy))
    else:
        results.append(_ineligible(StrategyFamily.THETA_A, EligibilityState.INELIGIBLE_STATE,
                                    "NO_ASSIGNMENT_OR_STOCK", "Neither assignment risk nor stock ownership present.", policy))

    # THETA-C: only relevant with CONFIRMED stock inventory -- never
    # speculative, never before assignment actually happened.
    if portfolio.stock_shares_held > 0:
        results.append(_eligible(StrategyFamily.THETA_C, EligibilityState.ELIGIBLE_PRIMARY,
                                  "CONFIRMED_STOCK_INVENTORY", f"stock_shares_held={portfolio.stock_shares_held}", policy))
    else:
        results.append(_ineligible(StrategyFamily.THETA_C, EligibilityState.INELIGIBLE_STRUCTURE,
                                    "NO_CONFIRMED_STOCK", "Covered calls require confirmed owned shares.", policy))

    # THETA-Q / THETA-H: only relevant to fresh entries -- i.e. cash
    # available and no conflicting existing exposure on this chain.
    entry_relevant = lifecycle == LifecycleState.CASH_AVAILABLE
    if not entry_relevant:
        for family in (StrategyFamily.THETA_Q, StrategyFamily.THETA_H, StrategyFamily.THETA_D):
            results.append(_ineligible(family, EligibilityState.INELIGIBLE_STATE,
                                        "NOT_A_FRESH_ENTRY_STATE", f"lifecycle_state={lifecycle.value}", policy))
    else:
        if market.ownership_acceptable is None:
            results.append(_ineligible(StrategyFamily.THETA_Q, EligibilityState.INELIGIBLE_DATA,
                                        "OWNERSHIP_UNKNOWN", "Ownership acceptability is UNKNOWN, not assumed acceptable.", policy))
        elif market.ownership_acceptable < policy.theta_q_min_ownership_acceptability:
            results.append(_ineligible(StrategyFamily.THETA_Q, EligibilityState.INELIGIBLE_RISK,
                                        "OWNERSHIP_UNACCEPTABLE", f"ownership_acceptable={market.ownership_acceptable} below THETA-Q floor.", policy))
        elif market.liquidity_acceptable is False:
            results.append(_ineligible(StrategyFamily.THETA_Q, EligibilityState.INELIGIBLE_DATA,
                                        "LIQUIDITY_UNACCEPTABLE", "Liquidity currently unacceptable.", policy))
        else:
            results.append(_eligible(StrategyFamily.THETA_Q, EligibilityState.ELIGIBLE_PRIMARY,
                                      "OWNERSHIP_AND_LIQUIDITY_OK", "Conventional entry conditions met.", policy))

        # THETA-H is a challenger with a STRICTER ownership bar (per its own
        # "only in validated cohorts" requirement) -- never inherits
        # THETA-Q's floor automatically.
        if market.ownership_acceptable is not None and not market.event_near:
            if market.ownership_acceptable >= policy.theta_h_min_ownership_acceptability:
                results.append(_eligible(StrategyFamily.THETA_H, EligibilityState.ELIGIBLE_CHALLENGER,
                                          "VALIDATED_COHORT_BAR_MET", "Stricter THETA-H ownership bar met, no near-term event.", policy))
            else:
                results.append(_ineligible(StrategyFamily.THETA_H, EligibilityState.INELIGIBLE_RISK,
                                            "BELOW_THETA_H_BAR", f"ownership_acceptable={market.ownership_acceptable} below THETA-H's stricter bar.", policy))
        else:
            results.append(_ineligible(StrategyFamily.THETA_H, EligibilityState.INELIGIBLE_STATE,
                                        "THETA_H_CONDITIONS_NOT_MET", "Event proximity or unknown ownership excludes THETA-H.", policy))

        # THETA-D remains gated regardless of state -- registered as a
        # possible challenger only once its explicit gate is satisfied.
        if policy.theta_d_gate_satisfied:
            results.append(_eligible(StrategyFamily.THETA_D, EligibilityState.ELIGIBLE_CHALLENGER,
                                      "GATE_SATISFIED", "Level 3 approval and archetype graduation confirmed.", policy))
        else:
            results.append(_ineligible(StrategyFamily.THETA_D, EligibilityState.INELIGIBLE_STATE,
                                        "GATE_NOT_SATISFIED", "THETA-D remains gated (docs/quant/research/data/strategy_archetypes.json).", policy))

    return results


def eligible_families(results: List[StrategyEligibilityResult]) -> List[StrategyFamily]:
    """Convenience filter: the families actually allowed to generate
    candidates this cycle -- never all of them, never a consensus vote."""
    return [r.strategy_family for r in results if r.eligible and r.eligibility_state in _ELIGIBLE_STATES]
