"""Research-side management-policy, exit-policy, and GLOBAL_WAIT contracts (R6D).

Structural scaffolding only -- enums and explanation-contract dataclasses,
never a Production decision engine (Codex owns Production; this module
never runs against real positions and never submits an order). Every
numerical/economic claim about which exit policy or WAIT reason is "right"
remains a HYPOTHESIS to be tested via `ablation.py`/`walk_forward.py`, never
asserted here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple


class ExitPolicyFamily(str, Enum):
    """Candidate exit-policy variants (R6D directive's own list) -- each is
    a HYPOTHESIS about when to close/roll a short option, evaluated over
    COMPLETE economic episodes (`episode_economics.py`'s
    `whole_episode_pnl`), never individual legs in isolation. None of these
    is canonical; the friend bot's fixed-TP/SL anecdote (profitable before,
    losing after adding a fixed TP/SL) is exactly the kind of uncontrolled
    single before/after comparison that motivates testing this family
    properly rather than adopting any one variant by inspection."""

    EXIT_FIXED_TP_SL = "EXIT_FIXED_TP_SL"
    EXIT_TIME_BASED = "EXIT_TIME_BASED"
    EXIT_PREMIUM_CAPTURE = "EXIT_PREMIUM_CAPTURE"
    EXIT_DYNAMIC_REMAINING_EV = "EXIT_DYNAMIC_REMAINING_EV"
    EXIT_DYNAMIC_EV_PLUS_HARD_RISK = "EXIT_DYNAMIC_EV_PLUS_HARD_RISK"
    EXIT_DYNAMIC_EV_PLUS_FLOW_INVALIDATION = "EXIT_DYNAMIC_EV_PLUS_FLOW_INVALIDATION"


class ManagementAction(str, Enum):
    """The feasible action set `ManagementUtility` compares. SELL_PARTIAL_
    STOCK is deliberately NOT included -- the R6D directive explicitly
    states its semantics are unspecified and instructs not to invent them;
    it must be added only once a real, TRD-versioned specification exists."""

    HOLD = "HOLD"
    CLOSE_FULL = "CLOSE_FULL"
    ROLL = "ROLL"
    ACCEPT_ASSIGNMENT = "ACCEPT_ASSIGNMENT"
    RECOVERY_WAIT = "RECOVERY_WAIT"
    SELL_STOCK = "SELL_STOCK"
    SELL_CC = "SELL_CC"
    CLOSE_CC = "CLOSE_CC"
    ROLL_CC = "ROLL_CC"
    ALLOW_CALL_AWAY = "ALLOW_CALL_AWAY"
    REDEPLOY = "REDEPLOY"


@dataclass(frozen=True)
class ActionEconomics:
    """One feasible action's own economics/risk snapshot -- the numbers a
    QuantWheel-style explanation must show, never a bare confidence
    percentage. Every field is Optional and None (never fabricated) when
    genuinely unknown; a caller comparing actions must handle None
    explicitly rather than treating it as zero."""

    action: ManagementAction
    remaining_ev: Optional[float]  # expected value if this action is taken, in the SAME after-cost units as ev_net elsewhere
    tail_risk: Optional[float]  # e.g. Expected Shortfall contribution
    capital_days_consumed: Optional[float]
    execution_cost: Optional[float]  # must not double-count if remaining_ev already nets execution cost -- see management_utility() docstring
    notes: Tuple[str, ...] = field(default_factory=tuple)


def management_utility(
    economics: ActionEconomics,
    tail_risk_aversion: float,
    capital_day_cost: float,
    execution_risk_aversion: float,
    opportunity_cost: Optional[float] = None,
) -> Optional[float]:
    """ManagementUtility(action) = remaining_ev - lambda*tail_risk -
    kappa*capital_days - xi*execution_risk - opportunity_cost (where
    separately modeled). All four weighting parameters
    (tail_risk_aversion=lambda, capital_day_cost=kappa,
    execution_risk_aversion=xi) are REQUIRED, caller-justified -- never a
    hardcoded default, per the standing "no arbitrary financial threshold"
    instruction.

    CAUTION (explicit, per the R6D directive): if `economics.remaining_ev`
    was already computed net of execution/slippage cost, `economics.
    execution_cost` passed here must be 0.0 (or this function's own
    execution_risk_aversion term set to 0.0) -- this function does NOT
    detect or prevent a double-subtraction of execution cost on its own;
    that is the caller's responsibility to get right, and is called out
    here specifically because it is an easy, easy-to-hide mistake.

    Returns None (never a fabricated utility) when `remaining_ev` is
    unknown -- a utility comparison cannot meaningfully rank an action
    whose core economic term is unknown against one whose is known."""
    if economics.remaining_ev is None:
        return None
    tail = economics.tail_risk or 0.0
    capital_days = economics.capital_days_consumed or 0.0
    execution = economics.execution_cost or 0.0
    opp = opportunity_cost or 0.0
    return (
        economics.remaining_ev
        - tail_risk_aversion * tail
        - capital_day_cost * capital_days
        - execution_risk_aversion * execution
        - opp
    )


@dataclass(frozen=True)
class ManagementDecisionExplanation:
    """The QuantWheel-style, deterministic, numerical explanation contract
    (R6D §30/§10) -- research-side only, never a Production UI. Answers:
    WHY OPEN / WHY HOLD / WHY CLOSE NOW / WHY NOT CLOSE / WHY ROLL / WHY
    ACCEPT ASSIGNMENT / WHY SELL COVERED CALL / WHY WAIT FOR RECOVERY /
    WHAT INVALIDATES THE POSITION / WHAT HARD RISK LIMIT OVERRIDES THE
    MODEL -- by construction, since every feasible action's own economics
    are recorded alongside the chosen one, never only the winner. Never a
    bare "confidence: 93%"-style claim unless genuinely calibrated (and if
    so, it must cite a real `calibration_metrics.py` result, not an
    assertion)."""

    position_label: str  # e.g. "AAPL CSP"
    actions_considered: Tuple[ActionEconomics, ...]
    utilities: Tuple[Optional[float], ...]  # index-aligned with actions_considered
    chosen_action: ManagementAction
    reason: str  # a plain-language, numerically-grounded statement, e.g. "remaining reward does not compensate for risk/capital usage"
    invalidation_conditions: Tuple[str, ...] = field(default_factory=tuple)  # what would invalidate the CHOSEN action if it changed
    hard_risk_override: Optional[str] = None  # a named hard limit that overrode the model's own utility ranking, if any

    def rejected_alternatives(self) -> List[Tuple[ManagementAction, Optional[float]]]:
        """Every considered action OTHER than the chosen one, with its own
        utility -- the "rejected alternatives" half of the explanation
        schema, always available, never only the winner reported."""
        return [
            (ae.action, u)
            for ae, u in zip(self.actions_considered, self.utilities)
            if ae.action != self.chosen_action
        ]


class GlobalWaitReason(str, Enum):
    """A global WAIT must be EARNED (R6D §15/§16) -- it is never simply "the
    first preferred structure failed." These are the reason families a
    GLOBAL_WAIT decision must cite; a preferred-CSP-filter failure alone is
    NOT one of these and does not by itself justify a global WAIT."""

    NO_POSITIVE_AFTER_COST_EV = "NO_POSITIVE_AFTER_COST_EV"  # every eligible candidate/branch/opportunity was evaluated and none cleared positive after-cost EV
    NO_RISK_FEASIBLE_CANDIDATE = "NO_RISK_FEASIBLE_CANDIDATE"  # positive-EV candidates existed but none passed risk/AEGIS constraints
    CAPITAL_UNAVAILABLE = "CAPITAL_UNAVAILABLE"  # no capital remained to commit to any otherwise-eligible candidate
    MARKET_SESSION_UNSUPPORTED = "MARKET_SESSION_UNSUPPORTED"  # session state does not support new risk (e.g. confirmed closed/unconfirmed)
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"  # required inputs were UNKNOWN/stale for enough of the eligible universe to prevent evaluation
    HARD_AEGIS_VETO = "HARD_AEGIS_VETO"  # a hard veto blocked all otherwise-eligible candidates


@dataclass(frozen=True)
class GlobalWaitEvidence:
    """The evidence a GLOBAL_WAIT decision must carry -- proof that the
    scan was actually exhaustive across every eligible surface named in the
    R6D directive, not merely that one preferred filter failed."""

    underlyings_evaluated: int
    contracts_evaluated: int
    validated_branches_evaluated: Tuple[str, ...]  # e.g. ("THETA-Q", "THETA-C", ...) -- which branches were actually checked
    existing_position_management_evaluated: bool
    recovery_opportunities_evaluated: bool
    cc_opportunities_evaluated: bool
    redeployment_alternatives_evaluated: bool
    reason: GlobalWaitReason
    reason_detail: str


def validate_global_wait_evidence(evidence: GlobalWaitEvidence, min_underlyings_evaluated: int) -> List[str]:
    """Returns a list of violations (empty = the WAIT was earned). This is
    a RESEARCH-CONTRACT validator -- it specifies what "earned" means, it
    does not implement or force Codex's runtime scanning loop.
    `min_underlyings_evaluated` is REQUIRED, caller-justified (e.g. the
    size of THETA's currently tradable universe) -- never a hardcoded
    default, since "how many underlyings must be checked before WAIT is
    earned" is exactly the kind of threshold the standing instruction
    requires the caller to supply and justify."""
    violations: List[str] = []
    if evidence.underlyings_evaluated < min_underlyings_evaluated:
        violations.append(
            f"only {evidence.underlyings_evaluated} underlying(s) evaluated, below the required minimum "
            f"{min_underlyings_evaluated} -- a preferred filter failing on a subset is not evidence the whole universe was checked"
        )
    if not evidence.validated_branches_evaluated:
        violations.append("no validated strategy branch was evaluated -- WAIT cannot be earned by checking zero branches")
    if not evidence.existing_position_management_evaluated:
        violations.append("existing-position management opportunities were not evaluated")
    if not evidence.recovery_opportunities_evaluated:
        violations.append("recovery opportunities were not evaluated")
    if not evidence.cc_opportunities_evaluated:
        violations.append("covered-call opportunities were not evaluated")
    if not evidence.redeployment_alternatives_evaluated:
        violations.append("redeployment alternatives were not evaluated")
    return violations
