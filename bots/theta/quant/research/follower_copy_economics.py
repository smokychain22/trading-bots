"""R4 fast-forward: follower sizing and copy-economics research contract.

THETA v1 has no follower accounts or copy execution -- this module is
RESEARCH preparation only. It never activates follower execution and
never assumes a follower receives the same economics as the master. Built
on `account_risk_capacity.py`'s per-account isolation contract (R3, this
same session).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple

from research.account_risk_capacity import AccountRiskCapacity, compute_account_qty_cap


class CopyDecision(str, Enum):
    COPY_ELIGIBLE = "COPY_ELIGIBLE"
    COPY_REDUCED = "COPY_REDUCED"
    SKIP = "SKIP"


@dataclass(frozen=True)
class FollowerSizingInputs:
    follower_capacity: AccountRiskCapacity
    required_collateral_per_contract: Optional[float]
    stress_loss_per_contract: Optional[float]
    concentration_key: str
    exposure_per_contract: Optional[float]
    assignment_shares_per_contract: float
    master_quantity: int  # what the master actually did -- NEVER assumed to be the follower's own quantity


def compute_follower_quantity(inputs: FollowerSizingInputs) -> int:
    """Qty_follower = min(collateral_capacity, assignment_capacity, tail_
    capacity, concentration_capacity, user/custom cap) -- computed ENTIRELY
    from the follower's OWN account state via `compute_account_qty_cap`.
    `master_quantity` is accepted only as an upper bound (a follower can
    never copy MORE contracts than the master itself traded) -- it is
    never used as a scaling factor or assumed floor. Zero is always valid;
    a follower may legitimately skip a trade the master took."""
    own_cap = compute_account_qty_cap(
        inputs.follower_capacity, inputs.required_collateral_per_contract, inputs.stress_loss_per_contract,
        inputs.concentration_key, inputs.exposure_per_contract, inputs.assignment_shares_per_contract,
    )
    return max(0, min(own_cap, inputs.master_quantity))


# ---------------------------------------------------------------------------
# Direction-aware copy pricing (Codex-identified defect, this session)
# ---------------------------------------------------------------------------
#
# THE BUG: `follower_price - master_price` was direction-agnostic. It is
# correct only for DEBIT transactions. For a CREDIT transaction (the
# overwhelming majority of THETA's own events -- it is a premium SELLER)
# the same arithmetic inverts the economics: a follower that received
# LESS credit than the master was scored as having a NEGATIVE (i.e.
# "better") deterioration, and a follower that received MORE credit was
# scored as worse. Any copyability limit built on it would therefore have
# blocked price IMPROVEMENTS and waved through genuine adverse fills.


class CashflowDirection(str, Enum):
    """The transaction's CASH direction -- the only thing that determines
    which way "worse" points.

    Never inferred from CALL/PUT: both a call and a put can be bought or
    sold. Never inferred from OPEN/CLOSE alone either: what matters is
    whether cash is received or paid, which is a property of the
    transaction, not of its lifecycle position. Callers pass it
    explicitly; `cashflow_direction_for_event` below offers only the
    CONVENTIONAL value for THETA's short-premium lifecycle and may be
    overridden."""

    CREDIT = "CREDIT"  # cash received -- MORE credit is better
    DEBIT = "DEBIT"  # cash paid -- LESS debit is better


#: The single signed convention used everywhere in this module.
DETERIORATION_SIGN_CONVENTION = (
    "positive = ADVERSE for the follower (worse than the master got); "
    "negative = follower PRICE IMPROVEMENT; zero = identical economics"
)


def cashflow_direction_for_event(event: "ChainLifecycleEvent") -> Optional[CashflowDirection]:
    """Conventional cash direction for THETA's SHORT-PREMIUM lifecycle
    only. Opening a short leg receives premium (CREDIT); buying that short
    leg back pays premium (DEBIT).

    Returns None -- never a guess -- for events that are not option
    transactions at all (ASSIGNMENT, CALL_AWAY are broker lifecycle
    outcomes with no quoted option fill price of their own).

    This is a CONVENIENCE for the standard case. A caller with a
    transaction whose real cash direction differs must pass the direction
    explicitly; nothing downstream infers it."""
    return _CONVENTIONAL_DIRECTION.get(event)


@dataclass(frozen=True)
class CopyDegradation:
    """Every field measuring how much worse (or better) the follower's
    OWN economics were versus the master's, at the SAME event. Every
    field Optional/None until real Paper/live TCA exists -- never
    fabricated as a fixed assumed degradation."""

    cashflow_direction: Optional[CashflowDirection]  # None = unknown; deterioration is then unknown too
    master_fill_price: Optional[float]
    follower_observed_bbo_mid: Optional[float]
    follower_theoretical_limit: Optional[float]
    follower_actual_fill_price: Optional[float]
    follower_fill_delay_seconds: Optional[float]
    price_deterioration_per_unit: Optional[float]  # signed per DETERIORATION_SIGN_CONVENTION
    price_deterioration_pct: Optional[float]  # same sign; denominator is abs(master price); None if that is 0/unknown
    spread_degradation: Optional[float]  # follower's own spread at fill time minus the master's own spread at fill time
    edge_decay: Optional[float]  # modeled_edge_at_master_fill - modeled_edge_at_follower_fill, positive = edge eroded during the copy delay
    return_degradation_pct: Optional[float]  # (follower_return - master_return) / abs(master_return), None if master_return is 0 or unknown


def compute_price_deterioration(
    master_price: Optional[float],
    follower_price: Optional[float],
    direction: Optional[CashflowDirection],
) -> Optional[float]:
    """Signed adverse price movement between the master's economics and
    the follower's, per `DETERIORATION_SIGN_CONVENTION`.

    CREDIT (cash received, more is better):
        deterioration = master_credit - follower_credit
        master 2.00, follower 1.90 -> +0.10 adverse
        master 2.00, follower 2.10 -> -0.10 improvement

    DEBIT (cash paid, less is better):
        deterioration = follower_debit - master_debit
        master 1.00, follower 1.10 -> +0.10 adverse
        master 1.00, follower 0.90 -> -0.10 improvement

    Returns None when either price OR the direction is unknown. An
    unknown direction is never defaulted to one of the two -- guessing it
    would silently invert the economics of half the lifecycle."""
    if master_price is None or follower_price is None or direction is None:
        return None
    if direction is CashflowDirection.CREDIT:
        return master_price - follower_price
    return follower_price - master_price


def compute_price_deterioration_pct(
    master_price: Optional[float],
    follower_price: Optional[float],
    direction: Optional[CashflowDirection],
) -> Optional[float]:
    """Deterioration as a fraction of the MASTER's own economic price --
    the explicit, stated denominator.

    Returns None (never 0.0, never a division error) whenever the
    deterioration itself is unknown or the master price is zero or
    unknown, because the ratio is then genuinely undefined. Sign matches
    `compute_price_deterioration`."""
    deterioration = compute_price_deterioration(master_price, follower_price, direction)
    if deterioration is None or not master_price:
        return None
    return deterioration / abs(master_price)


@dataclass(frozen=True)
class CopyabilityAssessment:
    decision: CopyDecision
    reasons: List[str]


def assess_copyability(
    inputs: FollowerSizingInputs,
    branch_compatible: bool,
    quote_fresh: bool,
    account_isolation_violations: List[str],
    price_deterioration: Optional[float] = None,
    max_price_deterioration: Optional[float] = None,
) -> CopyabilityAssessment:
    """Determines whether a master event can be economically replicated
    for this follower AT THIS MOMENT. Never an opaque copy score --
    every non-COPY_ELIGIBLE result carries an explicit reason. A follower
    may SKIP even when the master traded; nothing here assumes the
    follower's economics mirror the master's.

    `price_deterioration` must already be SIGNED per
    `DETERIORATION_SIGN_CONVENTION` (compute it with
    `compute_price_deterioration`, which needs the cash direction). Only a
    POSITIVE value is adverse, so a price improvement can never block a
    copy. `max_price_deterioration` is caller-supplied and
    caller-justified -- this module invents no limit. When a limit IS
    active but the deterioration is unknown, the copy is refused rather
    than allowed: unknown adverse pricing is not costless."""
    reasons: List[str] = []

    if account_isolation_violations:
        reasons.extend(account_isolation_violations)
        return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    if not branch_compatible:
        reasons.append("BRANCH_NOT_SUPPORTED_FOR_THIS_FOLLOWER_ACCOUNT")
        return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    if not quote_fresh:
        reasons.append("FOLLOWER_QUOTE_STALE_AT_COPY_TIME")
        return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    if max_price_deterioration is not None:
        if price_deterioration is None:
            reasons.append("FOLLOWER_PRICE_DETERIORATION_UNKNOWN_UNDER_ACTIVE_LIMIT")
            return CopyabilityAssessment(CopyDecision.SKIP, reasons)
        if price_deterioration > max_price_deterioration:
            reasons.append(
                f"FOLLOWER_ADVERSE_PRICE_DETERIORATION_EXCEEDS_LIMIT: "
                f"{price_deterioration} > {max_price_deterioration}"
            )
            return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    quantity = compute_follower_quantity(inputs)
    if quantity <= 0:
        reasons.append("FOLLOWER_ACCOUNT_CAPACITY_YIELDS_ZERO_QUANTITY")
        return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    if quantity < inputs.master_quantity:
        reasons.append(f"FOLLOWER_CAPACITY_BINDS_BELOW_MASTER_QUANTITY: {quantity} < {inputs.master_quantity}")
        return CopyabilityAssessment(CopyDecision.COPY_REDUCED, reasons)

    reasons.append("FOLLOWER_CAPACITY_SUPPORTS_FULL_MASTER_QUANTITY")
    return CopyabilityAssessment(CopyDecision.COPY_ELIGIBLE, reasons)


# ---------------------------------------------------------------------------
# Lifecycle eligibility: a follower that skipped ENTRY owns nothing to manage
# ---------------------------------------------------------------------------


class ChainLifecycleEvent(str, Enum):
    ENTRY = "ENTRY"
    CLOSE = "CLOSE"
    ROLL_CLOSE_OLD = "ROLL_CLOSE_OLD"
    ROLL_OPEN_NEW = "ROLL_OPEN_NEW"
    ASSIGNMENT = "ASSIGNMENT"
    SELL_CC = "SELL_CC"
    CALL_AWAY = "CALL_AWAY"


#: Conventional cash direction for THETA's short-premium lifecycle. A roll
#: is deliberately split: ROLL_CLOSE_OLD buys back the existing short leg
#: (DEBIT) while ROLL_OPEN_NEW sells the replacement leg (CREDIT) -- the
#: two legs have OPPOSITE cash directions, which is exactly why a roll can
#: never be scored as one combined deterioration number.
#: ASSIGNMENT/CALL_AWAY map to None: they are broker lifecycle outcomes,
#: not option transactions with a fill price of their own.
_CONVENTIONAL_DIRECTION: Dict["ChainLifecycleEvent", CashflowDirection] = {
    ChainLifecycleEvent.ENTRY: CashflowDirection.CREDIT,  # short put STO
    ChainLifecycleEvent.CLOSE: CashflowDirection.DEBIT,  # short put/CC BTC
    ChainLifecycleEvent.ROLL_CLOSE_OLD: CashflowDirection.DEBIT,
    ChainLifecycleEvent.ROLL_OPEN_NEW: CashflowDirection.CREDIT,
    ChainLifecycleEvent.SELL_CC: CashflowDirection.CREDIT,  # covered call STO
}


# ---------------------------------------------------------------------------
# Canonical Production vocabulary (src/customer/copy-engine-contract.ts,
# migration 021) -- research ADAPTS to it rather than competing with it
# ---------------------------------------------------------------------------

#: Canonical `copyActionSchema` action -> this module's research lifecycle
#: event, or None where the canonical action has no follower option
#: transaction to price (HOLD_STOCK, expiries, SELL_STOCK is equity).
CANONICAL_ACTION_TO_LIFECYCLE_EVENT: Dict[str, Optional["ChainLifecycleEvent"]] = {
    "OPEN_CSP": ChainLifecycleEvent.ENTRY,
    "REDUCE_CSP": ChainLifecycleEvent.CLOSE,
    "CLOSE_CSP": ChainLifecycleEvent.CLOSE,
    "EXPIRE_CSP": None,
    "ASSIGN_STOCK": ChainLifecycleEvent.ASSIGNMENT,
    "HOLD_STOCK": None,
    "SELL_STOCK": None,
    "OPEN_CC": ChainLifecycleEvent.SELL_CC,
    "REDUCE_CC": ChainLifecycleEvent.CLOSE,
    "CLOSE_CC": ChainLifecycleEvent.CLOSE,
    "EXPIRE_CC": None,
    "CALL_AWAY": ChainLifecycleEvent.CALL_AWAY,
}

#: Migration 021's `master_copy_event_explicit_roll_legs` CHECK and the
#: planner's `ROLL_REQUIRES_EXPLICIT_CLOSE_AND_OPEN_EVENTS` both REJECT
#: these two canonical actions at persistence time. They exist in the
#: TypeScript enum but can never reach a follower plan as one event --
#: the same invariant this module enforces via `evaluate_follower_roll`.
CANONICAL_ROLL_ACTIONS_REJECTED_AT_PERSISTENCE: Tuple[str, ...] = ("ROLL_CSP", "ROLL_CC")


def to_canonical_copy_outcome(assessment: "CopyabilityAssessment") -> str:
    """Maps this module's research `CopyDecision` onto canonical
    `copyOutcomeSchema` so research and Production speak one vocabulary.

    COPY_ELIGIBLE -> COPY_FULL; COPY_REDUCED -> COPY_REDUCED. A SKIP is
    split the way the canonical planner splits it: a capacity shortfall
    is SKIP_ACCOUNT (the follower is simply smaller), while an
    eligibility/integrity refusal is BLOCKED."""
    if assessment.decision is CopyDecision.COPY_ELIGIBLE:
        return "COPY_FULL"
    if assessment.decision is CopyDecision.COPY_REDUCED:
        return "COPY_REDUCED"
    capacity_skip = any("CAPACITY_YIELDS_ZERO_QUANTITY" in reason for reason in assessment.reasons)
    return "SKIP_ACCOUNT" if capacity_skip else "BLOCKED"


# ---------------------------------------------------------------------------
# Master-fill-first: master INTENT is never enough to justify a copy
# ---------------------------------------------------------------------------

#: Canonical actions whose copy requires a real master FILL (migration
#: 021's `master_copy_event_confirmation_matches_action`).
ORDER_PRODUCING_EVENTS: Tuple[ChainLifecycleEvent, ...] = (
    ChainLifecycleEvent.ENTRY, ChainLifecycleEvent.CLOSE,
    ChainLifecycleEvent.ROLL_CLOSE_OLD, ChainLifecycleEvent.ROLL_OPEN_NEW,
    ChainLifecycleEvent.SELL_CC,
)

#: Broker lifecycle outcomes: no fill exists, so a broker activity fact is
#: the confirmation instead.
LIFECYCLE_CONFIRMED_EVENTS: Tuple[ChainLifecycleEvent, ...] = (
    ChainLifecycleEvent.ASSIGNMENT, ChainLifecycleEvent.CALL_AWAY,
)


@dataclass(frozen=True)
class MasterConfirmation:
    """Broker truth about what the MASTER actually did. A decision, an
    order intent, or a submitted-but-unfilled order is NOT confirmation."""

    event: ChainLifecycleEvent
    master_fill_id: Optional[str]
    master_filled_quantity: int
    broker_activity_fact_id: Optional[str]


def master_confirmation_sufficient(confirmation: MasterConfirmation) -> Tuple[bool, str]:
    """R4 master-fill-first contract, mirroring the canonical planner's
    own `requireBrokerConfirmation`. Copying a master INTENT would copy
    trades the master never actually got, so an order-producing event
    needs a fill id AND a positive filled quantity, and a lifecycle event
    needs a broker activity fact.

    Returns (sufficient, reason) using canonical reason codes."""
    if confirmation.event in ORDER_PRODUCING_EVENTS:
        if confirmation.master_fill_id is None or confirmation.master_filled_quantity <= 0:
            return False, "MASTER_FILL_REQUIRED_BEFORE_COPY"
        return True, "MASTER_FILL_CONFIRMED"
    if confirmation.event in LIFECYCLE_CONFIRMED_EVENTS:
        if confirmation.broker_activity_fact_id is None:
            return False, "MASTER_BROKER_CONFIRMATION_REQUIRED"
        return True, "MASTER_LIFECYCLE_ACTIVITY_CONFIRMED"
    return False, f"UNHANDLED_LIFECYCLE_EVENT:{confirmation.event.value}"


@dataclass(frozen=True)
class FollowerChainParticipation:
    """What a follower actually holds for ONE master economic chain.
    `entered` is the root fact: a follower that never entered has no
    position, so every later event in that chain is structurally
    inapplicable to it -- not merely "skipped by policy"."""

    chain_id: str
    entered: bool
    open_option_quantity: float = 0.0
    owns_assigned_shares: bool = False
    has_open_covered_call: bool = False


def follower_may_participate(
    participation: FollowerChainParticipation, event: ChainLifecycleEvent
) -> Tuple[bool, str]:
    """R4 lifecycle-eligibility contract. A follower that skipped the
    ENTRY must remain absent from that chain's CLOSE, ROLL, ASSIGNMENT,
    CC and CALL_AWAY -- copying a close for a position you never opened
    would manufacture a phantom short, and copying an assignment you
    never underwrote would manufacture phantom stock.

    Returns (may_participate, reason)."""
    if event == ChainLifecycleEvent.ENTRY:
        return True, "ENTRY_IS_THE_FOLLOWER_S_OWN_INDEPENDENT_DECISION"

    if not participation.entered:
        return False, f"FOLLOWER_NEVER_ENTERED_CHAIN:{participation.chain_id} -- cannot copy {event.value}"

    if event in (ChainLifecycleEvent.CLOSE, ChainLifecycleEvent.ROLL_CLOSE_OLD):
        if participation.open_option_quantity <= 0:
            return False, f"FOLLOWER_HOLDS_NO_OPEN_OPTION_IN_CHAIN:{participation.chain_id}"
        return True, "FOLLOWER_HOLDS_THE_OPTION_BEING_CLOSED"

    if event == ChainLifecycleEvent.ROLL_OPEN_NEW:
        # Evaluated independently -- see `evaluate_follower_roll` below.
        return True, "NEW_LEG_REQUIRES_ITS_OWN_INDEPENDENT_FEASIBILITY_CHECK"

    if event == ChainLifecycleEvent.ASSIGNMENT:
        # A MASTER assignment never creates follower shares. Only the
        # follower's OWN short contract can be assigned to the follower.
        if participation.open_option_quantity <= 0:
            return False, f"FOLLOWER_HAS_NO_SHORT_OPTION_TO_BE_ASSIGNED_ON:{participation.chain_id}"
        return True, "FOLLOWER_HOLDS_THE_SHORT_OPTION_SUBJECT_TO_ASSIGNMENT"

    if event == ChainLifecycleEvent.SELL_CC:
        # Share ownership is read from the FOLLOWER's own lifecycle state;
        # the master's stock position is never borrowed as cover.
        if not participation.owns_assigned_shares:
            return False, f"FOLLOWER_OWNS_NO_SHARES_TO_COVER_A_CALL:{participation.chain_id}"
        return True, "FOLLOWER_OWNS_THE_SHARES_BEING_COVERED"

    if event == ChainLifecycleEvent.CALL_AWAY:
        # Master call-away is CONTEXT, not follower truth: the follower is
        # called away only when its own broker exercises its own CC.
        if not participation.has_open_covered_call:
            return False, f"FOLLOWER_HAS_NO_OPEN_COVERED_CALL_TO_BE_CALLED_AWAY:{participation.chain_id}"
        return True, "FOLLOWER_HOLDS_THE_COVERED_CALL_BEING_EXERCISED"

    return False, f"UNHANDLED_LIFECYCLE_EVENT:{event.value}"


# ---------------------------------------------------------------------------
# Roll semantics: never one magical action
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FollowerRollDecision:
    close_old_decision: CopyDecision
    close_old_reason: str
    open_new_decision: CopyDecision
    open_new_reason: str

    @property
    def is_partial_roll(self) -> bool:
        """True when the follower closes the old leg but does NOT open the
        new one -- a legitimate, expected outcome, never an error."""
        return self.close_old_decision != CopyDecision.SKIP and self.open_new_decision == CopyDecision.SKIP


def evaluate_follower_roll(
    participation: FollowerChainParticipation,
    new_leg_inputs: FollowerSizingInputs,
    new_leg_branch_compatible: bool,
    new_leg_quote_fresh: bool,
    account_isolation_violations: List[str],
) -> FollowerRollDecision:
    """A master ROLL is BTC-old plus STO-new. The follower evaluates each
    leg independently: it may close the old leg and SKIP the new one if
    economics or capacity changed. It may never copy a roll as one atomic
    action, and it may never open the new leg for a chain it never
    entered."""
    may_close, close_reason = follower_may_participate(participation, ChainLifecycleEvent.ROLL_CLOSE_OLD)
    close_decision = CopyDecision.COPY_ELIGIBLE if may_close else CopyDecision.SKIP

    if not participation.entered:
        return FollowerRollDecision(
            close_old_decision=CopyDecision.SKIP, close_old_reason=close_reason,
            open_new_decision=CopyDecision.SKIP,
            open_new_reason=f"FOLLOWER_NEVER_ENTERED_CHAIN:{participation.chain_id} -- no new leg to roll into",
        )

    new_leg = assess_copyability(
        new_leg_inputs, branch_compatible=new_leg_branch_compatible,
        quote_fresh=new_leg_quote_fresh, account_isolation_violations=account_isolation_violations,
    )
    return FollowerRollDecision(
        close_old_decision=close_decision, close_old_reason=close_reason,
        open_new_decision=new_leg.decision, open_new_reason="; ".join(new_leg.reasons),
    )


# ---------------------------------------------------------------------------
# Master/follower economic degradation (R4 section 32)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CopyTimeline:
    """Every timestamp in a copy event. All Optional -- an unrecorded
    timestamp stays None and makes any derived delay None, never 0."""

    master_decision_time: Optional[str]
    master_fill_time: Optional[str]
    copy_event_time: Optional[str]
    follower_observation_time: Optional[str]
    follower_fill_time: Optional[str]


def compute_copy_delay_seconds(timeline: CopyTimeline) -> Optional[float]:
    """Seconds between the master's own fill and the follower's fill.
    None whenever either timestamp is missing -- never a zero delay."""
    if timeline.master_fill_time is None or timeline.follower_fill_time is None:
        return None
    from datetime import datetime

    def _parse(value: str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    return (_parse(timeline.follower_fill_time) - _parse(timeline.master_fill_time)).total_seconds()


def compute_edge_degradation(master_edge: Optional[float], follower_edge: Optional[float]) -> Optional[float]:
    """Positive = edge eroded between the master's own decision and the
    follower's. None whenever either edge is unknown -- and both remain
    unknown until a calibrated EV model exists."""
    if master_edge is None or follower_edge is None:
        return None
    return master_edge - follower_edge


def compute_return_degradation_pct(master_return: Optional[float], follower_return: Optional[float]) -> Optional[float]:
    """Relative return shortfall. None when either return is unknown OR
    when the master's own return is zero (an undefined ratio, never
    reported as 0% or 100%)."""
    if master_return is None or follower_return is None or master_return == 0:
        return None
    return (follower_return - master_return) / abs(master_return)


# ---------------------------------------------------------------------------
# R4 exit check
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class R4ExitCheck:
    follower_sized_from_own_capacity_only: bool
    zero_quantity_is_valid: bool
    copy_decisions_carry_reasons: bool
    skipped_entry_excludes_whole_chain: bool
    roll_legs_evaluated_independently: bool
    degradation_metrics_unknown_until_paper: bool
    direction_aware_price_deterioration: bool  # CREDIT and DEBIT score adverse movement in OPPOSITE arithmetic directions
    master_fill_confirmed_before_copy: bool  # master INTENT is never sufficient


def r4_quant_copy_contract(check: R4ExitCheck) -> str:
    """"PASS" only when every criterion holds. PASS means the QUANT/
    RESEARCH side is ready -- it does NOT mean a Production copy engine
    exists or that follower execution is activated."""
    return "PASS" if all(getattr(check, name) for name in check.__dataclass_fields__) else "FAIL"
