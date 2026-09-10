"""Management action-value model (Phase 2B-quant).

Implements the same-state ManagementUtility comparison across every open-
position management action THETA can take, per
docs/quant/phase5_management/ACTION_VALUE_FORMULAS.md and
docs/quant/phase2/FORMULA_REGISTRY.md's ManagementUtility/RollUtility. Every
alternative is evaluated from ONE shared, timestamped :class:`ManagementContext`
snapshot -- never comparing an old-state HOLD against a future-state ROLL
(H-M-01, RETAIN, docs/quant/phase5_management/MANAGEMENT_HYPOTHESIS_LIBRARY.md).

This is a transparent baseline (MODEL-001): explicit, reason-coded formulas
over named inputs, not a fitted model. Where a valuation genuinely requires a
forward-looking probability estimate (e.g. the expected value of a brand-new
replacement leg opened by a ROLL), that estimate is an explicit, optional,
externally-supplied input (``estimated_future_value``) -- exactly like
``theta_q_baseline.py``'s own ``ev_net=None`` discipline. This module never
fabricates that estimate itself; no calibrated entry-outcome/management
probability model exists yet (see docs/quant/phase2/MODEL_REGISTRY.md), so
until one does, every action whose correctness depends on a genuine forward
probability reports ``utility=None`` (UNKNOWN) rather than inventing one.

No I/O, no provider dependency. Every policy threshold is a required
constructor argument on :class:`ManagementPolicy` -- nothing here defaults
silently.

VALUATION CONVENTION (clarified following a Codex review question about
whether entry premium could be double-counted, or dropped, across
alternatives): every ``certain_cashflow``, ``estimated_future_value``, and
``utility`` this module reports is measured on a **total economic P&L since
original entry** basis, so every action is directly comparable to every
other. Concretely:

- CLOSE's cashflow (``entry_credit_per_share - current_ask_per_share``) is
  already total-since-entry -- this is the reference convention every other
  action must match.
- EXPIRE's cashflow (full ``entry_credit_per_share``) is total-since-entry
  by construction (the short option expired worthless).
- ROLL's ``certain_cashflow`` is **the old leg's total-since-entry value if
  closed right now (identical to CLOSE's formula) PLUS the new leg's own
  opening cash-in**, NOT the canonical ``NetRollCredit`` transactional
  quantity (``NewOpeningCredit - OldCloseDebit``) on its own -- that
  quantity is transactional (what changes hands at the moment of the roll)
  and deliberately omits the old leg's original entry credit, which would
  silently undervalue ROLL relative to CLOSE by exactly
  ``entry_credit_per_share * multiplier`` if used as the comparison basis
  directly. ``NetRollCredit`` remains reportable/derivable as
  ``certain_cashflow - entry_credit_per_share * multiplier`` wherever a
  caller wants the transactional figure specifically (e.g. for a receipt),
  but it is never what this module compares actions by.
- HOLD's ``hold_forward_value``, ROLL's/ASSIGN's/REDEPLOY's
  ``estimated_future_value`` are externally supplied and MUST be computed
  on this same total-since-entry basis by whatever model eventually
  produces them (e.g. HOLD's forward value should already net the entry
  credit collected against the expected cost/resolution of continuing to
  hold, not report only the incremental piece from now forward) -- a
  caller that supplies an incremental-only quantity here would understate
  that action relative to CLOSE/EXPIRE/ROLL's total-since-entry figures.
  This module cannot enforce that a caller respects this convention (the
  values are opaque floats), so it is stated here explicitly rather than
  left implicit, per the correctness review that prompted this note.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence

from models.common import ReasonCode
from research.candidate_actions import CandidateAction


# ---------------------------------------------------------------------------
# Policy (versioned, no hardcoded defaults)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ManagementPolicy:
    policy_version: str
    execution_cost_per_contract: float
    capital_days_penalty_rate: float  # cost per dollar of capital committed per day held
    tail_risk_penalty_weight: float  # multiplies capital_committed * p_severe_drawdown into a $ penalty


# ---------------------------------------------------------------------------
# Shared decision-state snapshot and per-action detail
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OpenOptionLegState:
    """The currently open short option leg being managed, if any."""

    entry_credit_per_share: float
    current_bid_per_share: Optional[float]
    current_ask_per_share: Optional[float]  # what BTC would cost -- never assumed to be the mid
    strike: float
    multiplier: float
    dte: int


@dataclass(frozen=True)
class RollCandidate:
    """A specific replacement contract under consideration for ROLL. The new
    leg's own forward value is genuinely uncertain -- ``estimated_future_value``
    is an explicit pass-through for a future calibrated model's output, never
    computed by this module. Per the module docstring's VALUATION CONVENTION:
    this value covers ONLY the new leg's own forward economics (the old
    leg's total-since-entry value is computed separately, from
    ``entry_credit_per_share``, and added automatically) -- never re-include
    the old leg's entry credit here, or it would be counted twice."""

    new_strike: float
    new_dte: int
    new_credit_per_share: Optional[float]
    estimated_future_value: Optional[float]  # None until a real entry-outcome model exists


@dataclass(frozen=True)
class AssignAlternative:
    """ACCEPT_ASSIGNMENT's forward value, supplied externally (depends on the
    ownership/recovery models -- SPECIFIED, not fitted yet). Per the module
    docstring's VALUATION CONVENTION: must be on a total-since-entry basis,
    consistent with every other action's valuation."""

    estimated_future_value: Optional[float]


@dataclass(frozen=True)
class RedeployAlternative:
    """Redeploying freed capital elsewhere -- forward value externally
    supplied. Per the module docstring's VALUATION CONVENTION: must be on a
    total-since-entry basis, consistent with every other action's valuation."""

    estimated_future_value: Optional[float]


@dataclass(frozen=True)
class ManagementContext:
    """One shared, timestamped decision-state snapshot. Every action below is
    valued FROM this same snapshot -- never a mix of old/new state."""

    as_of: str  # ISO timestamp, informational/audit only -- not read by any formula
    open_option_leg: Optional[OpenOptionLegState]
    roll_candidate: Optional[RollCandidate]
    assign_alternative: Optional[AssignAlternative]
    redeploy_alternative: Optional[RedeployAlternative]
    capital_committed: Optional[float]
    hold_forward_value: Optional[float]  # HOLD's own expected forward value; None if unmodeled
    p_severe_drawdown: Optional[float]
    at_expiration_otm: bool  # caller-supplied fact: is this leg expiring OTM right now


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ActionValuation:
    action: CandidateAction
    feasible: bool
    certain_cashflow: Optional[float]
    estimated_future_value: Optional[float]
    tail_risk_penalty: Optional[float]
    capital_days_penalty: Optional[float]
    execution_penalty: Optional[float]
    utility: Optional[float]
    reasons: List[ReasonCode]


@dataclass(frozen=True)
class ManagementDecision:
    valuations: List[ActionValuation]
    selected_action: CandidateAction
    selected_reasons: List[ReasonCode]


def _tail_risk_penalty(policy: ManagementPolicy, ctx: ManagementContext) -> Optional[float]:
    if ctx.p_severe_drawdown is None or ctx.capital_committed is None:
        return None
    return policy.tail_risk_penalty_weight * ctx.p_severe_drawdown * ctx.capital_committed


def _capital_days_penalty(policy: ManagementPolicy, ctx: ManagementContext, days: int) -> Optional[float]:
    if ctx.capital_committed is None:
        return None
    return policy.capital_days_penalty_rate * ctx.capital_committed * days


def _hold_valuation(policy: ManagementPolicy, ctx: ManagementContext) -> ActionValuation:
    reasons: List[ReasonCode] = []
    tail = _tail_risk_penalty(policy, ctx)
    # HOLD's forward capital-days horizon is unbounded/unknown at this single
    # decision timestamp -- we charge one day's penalty as the marginal cost
    # of holding one more day, since that is what "continuing to hold, right
    # now" actually costs; the alternative's own days_estimate (if any)
    # reflects its own horizon instead.
    capital_days = _capital_days_penalty(policy, ctx, days=1)
    forward = ctx.hold_forward_value
    if forward is None:
        reasons.append(ReasonCode("HOLD_FORWARD_VALUE_UNKNOWN", -1, "No forward value model supplied for HOLD."))
        utility = None
    elif tail is None or capital_days is None:
        reasons.append(ReasonCode("HOLD_PENALTY_INPUTS_UNKNOWN", -1, "capital_committed/p_severe_drawdown unknown."))
        utility = None
    else:
        utility = forward - tail - capital_days
        reasons.append(ReasonCode("HOLD_VALUED", 0, f"utility={utility}"))
    return ActionValuation(
        action=CandidateAction.HOLD,
        feasible=True,
        certain_cashflow=0.0,
        estimated_future_value=forward,
        tail_risk_penalty=tail,
        capital_days_penalty=capital_days,
        execution_penalty=0.0,
        utility=utility,
        reasons=reasons,
    )


def _close_valuation(policy: ManagementPolicy, ctx: ManagementContext) -> ActionValuation:
    leg = ctx.open_option_leg
    if leg is None:
        return ActionValuation(
            action=CandidateAction.CLOSE, feasible=False, certain_cashflow=None,
            estimated_future_value=None, tail_risk_penalty=None, capital_days_penalty=None,
            execution_penalty=None, utility=None,
            reasons=[ReasonCode("NO_OPEN_LEG", -1, "CLOSE is infeasible without an open option leg.")],
        )
    if leg.current_ask_per_share is None:
        return ActionValuation(
            action=CandidateAction.CLOSE, feasible=True, certain_cashflow=None,
            estimated_future_value=0.0, tail_risk_penalty=0.0, capital_days_penalty=0.0,
            execution_penalty=policy.execution_cost_per_contract, utility=None,
            reasons=[ReasonCode("CLOSE_QUOTE_UNKNOWN", -1, "Current ask (BTC cost) is UNKNOWN, not assumed favorable.")],
        )
    # Closing realizes this leg's economics NOW and ends all further capital
    # lock-up/tail exposure on it -- both are certain (0.0), not UNKNOWN,
    # because CLOSE has no forward horizon left to charge a penalty against.
    cashflow = (leg.entry_credit_per_share - leg.current_ask_per_share) * leg.multiplier
    execution_penalty = policy.execution_cost_per_contract
    utility = cashflow - execution_penalty
    return ActionValuation(
        action=CandidateAction.CLOSE, feasible=True, certain_cashflow=cashflow,
        estimated_future_value=0.0, tail_risk_penalty=0.0, capital_days_penalty=0.0,
        execution_penalty=execution_penalty, utility=utility,
        reasons=[ReasonCode("CLOSE_VALUED", 0, f"realized_cashflow={cashflow}")],
    )


def _expire_valuation(ctx: ManagementContext) -> ActionValuation:
    leg = ctx.open_option_leg
    if leg is None or not ctx.at_expiration_otm:
        return ActionValuation(
            action=CandidateAction.EXPIRE, feasible=False, certain_cashflow=None,
            estimated_future_value=None, tail_risk_penalty=None, capital_days_penalty=None,
            execution_penalty=None, utility=None,
            reasons=[ReasonCode("NOT_AT_EXPIRATION_OTM", -1, "EXPIRE only feasible at expiration, clearly OTM.")],
        )
    cashflow = leg.entry_credit_per_share * leg.multiplier
    return ActionValuation(
        action=CandidateAction.EXPIRE, feasible=True, certain_cashflow=cashflow,
        estimated_future_value=0.0, tail_risk_penalty=0.0, capital_days_penalty=0.0,
        execution_penalty=0.0, utility=cashflow,
        reasons=[ReasonCode("EXPIRE_VALUED", 1, f"full_premium_capture={cashflow}")],
    )


def _roll_valuation(policy: ManagementPolicy, ctx: ManagementContext) -> ActionValuation:
    leg, roll = ctx.open_option_leg, ctx.roll_candidate
    if leg is None or roll is None:
        return ActionValuation(
            action=CandidateAction.ROLL, feasible=False, certain_cashflow=None,
            estimated_future_value=None, tail_risk_penalty=None, capital_days_penalty=None,
            execution_penalty=None, utility=None,
            reasons=[ReasonCode("NO_ROLL_CANDIDATE", -1, "ROLL requires both an open leg and a replacement contract.")],
        )
    if leg.current_ask_per_share is None or roll.new_credit_per_share is None:
        return ActionValuation(
            action=CandidateAction.ROLL, feasible=True, certain_cashflow=None,
            estimated_future_value=roll.estimated_future_value, tail_risk_penalty=None,
            capital_days_penalty=None, execution_penalty=2 * policy.execution_cost_per_contract, utility=None,
            reasons=[ReasonCode("ROLL_QUOTE_UNKNOWN", -1, "Old-leg BTC price or new-leg credit is UNKNOWN.")],
        )
    execution_penalty = 2 * policy.execution_cost_per_contract  # close old + open new
    # Old leg's total-since-entry value if closed right now -- IDENTICAL to
    # _close_valuation's own formula, so ROLL and CLOSE are compared on the
    # same basis -- plus the new leg's own opening cash-in. This is NOT the
    # canonical NetRollCredit transactional quantity on its own (see the
    # module docstring's VALUATION CONVENTION section): using
    # (new_credit - old_ask) alone here would silently drop the old leg's
    # entry_credit_per_share from the comparison, undervaluing every roll
    # relative to CLOSE/EXPIRE by exactly entry_credit_per_share * multiplier.
    old_leg_close_value = (leg.entry_credit_per_share - leg.current_ask_per_share) * leg.multiplier - policy.execution_cost_per_contract
    new_leg_open_value = roll.new_credit_per_share * leg.multiplier - policy.execution_cost_per_contract
    certain_cashflow = old_leg_close_value + new_leg_open_value
    net_roll_credit = certain_cashflow - leg.entry_credit_per_share * leg.multiplier  # canonical transactional figure, reportable only
    capital_days = _capital_days_penalty(policy, ctx, days=roll.new_dte)
    tail = _tail_risk_penalty(policy, ctx)
    reasons: List[ReasonCode] = [ReasonCode(
        "ROLL_ECONOMICS", 0,
        f"certain_cashflow(total-since-entry)={certain_cashflow} net_roll_credit(transactional)={net_roll_credit}",
    )]
    if roll.estimated_future_value is None or capital_days is None or tail is None:
        reasons.append(ReasonCode(
            "ROLL_FUTURE_VALUE_UNKNOWN", -1,
            "New leg's forward value/penalty inputs are UNKNOWN -- a positive NetRollCredit alone is "
            "never treated as proof the roll is good (H-R-03).",
        ))
        return ActionValuation(
            action=CandidateAction.ROLL, feasible=True, certain_cashflow=certain_cashflow,
            estimated_future_value=roll.estimated_future_value, tail_risk_penalty=tail,
            capital_days_penalty=capital_days, execution_penalty=execution_penalty, utility=None,
            reasons=reasons,
        )
    utility = certain_cashflow + roll.estimated_future_value - tail - capital_days
    reasons.append(ReasonCode("ROLL_VALUED", 0, f"utility={utility}"))
    return ActionValuation(
        action=CandidateAction.ROLL, feasible=True, certain_cashflow=certain_cashflow,
        estimated_future_value=roll.estimated_future_value, tail_risk_penalty=tail,
        capital_days_penalty=capital_days, execution_penalty=execution_penalty, utility=utility,
        reasons=reasons,
    )


def _assign_valuation(policy: ManagementPolicy, ctx: ManagementContext) -> ActionValuation:
    assign = ctx.assign_alternative
    if assign is None:
        return ActionValuation(
            action=CandidateAction.ASSIGN, feasible=False, certain_cashflow=None,
            estimated_future_value=None, tail_risk_penalty=None, capital_days_penalty=None,
            execution_penalty=None, utility=None,
            reasons=[ReasonCode("ASSIGNMENT_NOT_OFFERED", -1, "No assignment alternative supplied at this timestamp.")],
        )
    tail = _tail_risk_penalty(policy, ctx)
    if assign.estimated_future_value is None or tail is None:
        return ActionValuation(
            action=CandidateAction.ASSIGN, feasible=True, certain_cashflow=0.0,
            estimated_future_value=assign.estimated_future_value, tail_risk_penalty=tail,
            capital_days_penalty=None, execution_penalty=0.0, utility=None,
            reasons=[ReasonCode("ASSIGN_FUTURE_VALUE_UNKNOWN", -1, "Assignment's forward economics are UNKNOWN.")],
        )
    utility = assign.estimated_future_value - tail
    return ActionValuation(
        action=CandidateAction.ASSIGN, feasible=True, certain_cashflow=0.0,
        estimated_future_value=assign.estimated_future_value, tail_risk_penalty=tail,
        capital_days_penalty=0.0, execution_penalty=0.0, utility=utility,
        reasons=[ReasonCode("ASSIGN_VALUED", 0, f"utility={utility}")],
    )


def _redeploy_valuation(ctx: ManagementContext) -> ActionValuation:
    redeploy = ctx.redeploy_alternative
    if redeploy is None or redeploy.estimated_future_value is None:
        return ActionValuation(
            action=CandidateAction.REDEPLOY, feasible=redeploy is not None, certain_cashflow=None,
            estimated_future_value=None, tail_risk_penalty=None, capital_days_penalty=None,
            execution_penalty=None, utility=None,
            reasons=[ReasonCode("REDEPLOY_VALUE_UNKNOWN", -1, "No redeploy alternative valued at this timestamp.")],
        )
    return ActionValuation(
        action=CandidateAction.REDEPLOY, feasible=True, certain_cashflow=0.0,
        estimated_future_value=redeploy.estimated_future_value, tail_risk_penalty=0.0,
        capital_days_penalty=0.0, execution_penalty=0.0, utility=redeploy.estimated_future_value,
        reasons=[ReasonCode("REDEPLOY_VALUED", 0, f"utility={redeploy.estimated_future_value}")],
    )


def evaluate_management_alternatives(
    policy: ManagementPolicy, ctx: ManagementContext
) -> ManagementDecision:
    """Values every feasible management action from the SAME ``ctx`` snapshot
    and selects the highest-utility one. Never forces a choice: if no
    alternative has a known utility exceeding HOLD's, HOLD is selected --
    mirroring "WAIT is valid, never force a trade" for the management
    surface. If HOLD's own utility is also unknown, HOLD is still selected
    (the conservative default), per "never force a trade."
    """
    valuations = [
        _hold_valuation(policy, ctx),
        _close_valuation(policy, ctx),
        _expire_valuation(ctx),
        _roll_valuation(policy, ctx),
        _assign_valuation(policy, ctx),
        _redeploy_valuation(ctx),
    ]

    hold = valuations[0]
    best = hold
    for valuation in valuations[1:]:
        if not valuation.feasible or valuation.utility is None:
            continue
        if best.utility is None or valuation.utility > best.utility:
            best = valuation

    reasons = list(best.reasons)
    if best.action is CandidateAction.HOLD:
        reasons.append(ReasonCode(
            "HOLD_SELECTED_AS_DEFAULT", 0,
            "No feasible alternative had a known utility exceeding HOLD -- never forcing a trade.",
        ))

    return ManagementDecision(valuations=valuations, selected_action=best.action, selected_reasons=reasons)


def hold_advantage(decision: ManagementDecision) -> Optional[float]:
    """HoldAdvantage = U_HOLD - max(U_CLOSE, U_ROLL, U_ASSIGN, U_EXPIRE, U_REDEPLOY).

    A named, inspectable quantity (not just an implicit argmax) for exactly
    the question a fixed-percentage TP/SL rule can't answer: does continuing
    to hold still dominate every alternative, right now, given the current
    state -- never "has an arbitrary threshold been crossed." Positive means
    HOLD remains superior; negative means some alternative already dominates
    it (a signal that a fixed TP/SL benchmark comparison would miss if it
    only checked premium captured). None if HOLD's utility, or every
    feasible alternative's utility, is unknown -- never fabricated.
    """
    hold = next(v for v in decision.valuations if v.action == CandidateAction.HOLD)
    if hold.utility is None:
        return None
    alternative_utilities = [
        v.utility
        for v in decision.valuations
        if v.action != CandidateAction.HOLD and v.feasible and v.utility is not None
    ]
    if not alternative_utilities:
        return None
    return hold.utility - max(alternative_utilities)
