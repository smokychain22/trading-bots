"""AEGIS risk engine (Phase 2C-quant): canonical risk-state computation.

Implements the AEGIS risk contract: ALLOW_FULL / ALLOW_REDUCED /
DEFINED_RISK_ONLY / HOLD_ONLY / HARD_VETO, evaluated across independent risk
families (never fused into one blended score -- TRD CAND-003), with the
STRICTEST applicable family state winning for new-risk decisions
(docs/quant/phase2/AEGIS_SIZING_EXECUTION_CONTRACT.md §2/§5).

Implements EXIT SUPREMACY explicitly via :func:`is_action_permitted`: a
restrictive new-risk state must never block a legitimate risk-reducing
action -- this resolves the correction-audit gap recorded in
docs/quant/PHASE2_4_CORRECTION_AUDIT.md finding 6.

Every UNKNOWN input maps to a RESTRICTIVE state, never a permissive one
(fail-closed) -- this module never assumes a missing risk input is fine.
No martingale/loss-doubling logic exists anywhere in this module; that
guard lives in sizing.py, which is downstream of (and cannot override) the
risk states computed here.
"""

from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet, List, Optional

from models.common import ReasonCode


class RiskState(str, Enum):
    ALLOW_FULL = "ALLOW_FULL"
    ALLOW_REDUCED = "ALLOW_REDUCED"
    DEFINED_RISK_ONLY = "DEFINED_RISK_ONLY"
    HOLD_ONLY = "HOLD_ONLY"
    HARD_VETO = "HARD_VETO"


_STRICTNESS_ORDER = [
    RiskState.ALLOW_FULL,
    RiskState.ALLOW_REDUCED,
    RiskState.DEFINED_RISK_ONLY,
    RiskState.HOLD_ONLY,
    RiskState.HARD_VETO,
]


class RiskFamily(str, Enum):
    PER_TRADE = "PER_TRADE"
    UNDERLYING = "UNDERLYING"
    SECTOR = "SECTOR"
    CORRELATION = "CORRELATION"
    PORTFOLIO = "PORTFOLIO"
    INVENTORY = "INVENTORY"
    ASSIGNMENT = "ASSIGNMENT"
    RECOVERY = "RECOVERY"
    LIQUIDITY = "LIQUIDITY"
    EXECUTION = "EXECUTION"
    PROVIDER = "PROVIDER"
    SYSTEM = "SYSTEM"


@dataclass(frozen=True)
class RiskFamilyAssessment:
    family: RiskFamily
    state: RiskState
    reasons: List[ReasonCode]


@dataclass(frozen=True)
class AegisPolicy:
    policy_version: str
    max_ticker_concentration_pct: float
    max_sector_concentration_pct: float
    max_correlation_cluster_pct: float
    max_portfolio_capital_at_risk_pct: float
    max_inventory_capacity_pct: float
    max_assignment_capacity_pct: float
    max_recovery_capacity_pct: float
    provider_required_states: FrozenSet[str]


@dataclass(frozen=True)
class AegisInputs:
    ticker_concentration_pct: Optional[float]
    sector_concentration_pct: Optional[float]
    correlation_cluster_exposure_pct: Optional[float]
    portfolio_capital_at_risk_pct: Optional[float]
    inventory_capacity_used_pct: Optional[float]
    assignment_capacity_used_pct: Optional[float]
    recovery_capacity_used_pct: Optional[float]
    liquidity_acceptable: Optional[bool]
    execution_quality_acceptable: Optional[bool]
    provider_state: Optional[str]
    stress_gap_detected: Optional[bool]
    stress_iv_shock_detected: Optional[bool]
    stress_spread_widening_detected: Optional[bool]


@dataclass(frozen=True)
class AegisAssessment:
    families: List[RiskFamilyAssessment]
    new_risk_state: RiskState
    reasons: List[ReasonCode]


def _worse(a: RiskState, b: RiskState) -> RiskState:
    return a if _STRICTNESS_ORDER.index(a) >= _STRICTNESS_ORDER.index(b) else b


def _threshold_assessment(
    family: RiskFamily, value: Optional[float], soft_cap: float, hard_cap_multiplier: float = 1.5
) -> RiskFamilyAssessment:
    if value is None:
        return RiskFamilyAssessment(family, RiskState.HOLD_ONLY, [ReasonCode(f"{family.value}_UNKNOWN", -1, "Input is UNKNOWN, not assumed acceptable.")])
    if value >= soft_cap * hard_cap_multiplier:
        return RiskFamilyAssessment(family, RiskState.HARD_VETO, [ReasonCode(f"{family.value}_SEVERELY_EXCEEDED", -1, f"value={value} >= {soft_cap * hard_cap_multiplier}")])
    if value >= soft_cap:
        return RiskFamilyAssessment(family, RiskState.ALLOW_REDUCED, [ReasonCode(f"{family.value}_EXCEEDED", -1, f"value={value} >= cap {soft_cap}")])
    return RiskFamilyAssessment(family, RiskState.ALLOW_FULL, [ReasonCode(f"{family.value}_OK", 1, f"value={value} within cap {soft_cap}")])


def _per_trade(inputs: AegisInputs) -> RiskFamilyAssessment:
    if inputs.liquidity_acceptable is False:
        return RiskFamilyAssessment(RiskFamily.PER_TRADE, RiskState.HARD_VETO, [ReasonCode("PER_TRADE_LIQUIDITY_FAILED", -1, "Per-trade liquidity check failed.")])
    if inputs.liquidity_acceptable is None:
        return RiskFamilyAssessment(RiskFamily.PER_TRADE, RiskState.HOLD_ONLY, [ReasonCode("PER_TRADE_LIQUIDITY_UNKNOWN", -1, "Per-trade liquidity is UNKNOWN.")])
    return RiskFamilyAssessment(RiskFamily.PER_TRADE, RiskState.ALLOW_FULL, [ReasonCode("PER_TRADE_OK", 1, "Liquidity acceptable.")])


def _liquidity(inputs: AegisInputs) -> RiskFamilyAssessment:
    if inputs.stress_spread_widening_detected:
        return RiskFamilyAssessment(RiskFamily.LIQUIDITY, RiskState.ALLOW_REDUCED, [ReasonCode("SPREAD_WIDENING_DETECTED", -1, "Book-level spread widening stress detected.")])
    return RiskFamilyAssessment(RiskFamily.LIQUIDITY, RiskState.ALLOW_FULL, [ReasonCode("LIQUIDITY_OK", 1, "No book-level spread-widening stress detected.")])


def _execution(inputs: AegisInputs) -> RiskFamilyAssessment:
    if inputs.execution_quality_acceptable is False:
        return RiskFamilyAssessment(RiskFamily.EXECUTION, RiskState.DEFINED_RISK_ONLY, [ReasonCode("EXECUTION_QUALITY_POOR", -1, "Execution-quality model reports unacceptable quality -- restrict to defined-risk structures only.")])
    if inputs.execution_quality_acceptable is None:
        return RiskFamilyAssessment(RiskFamily.EXECUTION, RiskState.HOLD_ONLY, [ReasonCode("EXECUTION_QUALITY_UNKNOWN", -1, "Execution quality is UNKNOWN.")])
    return RiskFamilyAssessment(RiskFamily.EXECUTION, RiskState.ALLOW_FULL, [ReasonCode("EXECUTION_OK", 1, "Execution quality acceptable.")])


def _provider(policy: AegisPolicy, inputs: AegisInputs) -> RiskFamilyAssessment:
    if inputs.provider_state is None:
        return RiskFamilyAssessment(RiskFamily.PROVIDER, RiskState.HOLD_ONLY, [ReasonCode("PROVIDER_STATE_UNKNOWN", -1, "Provider state is UNKNOWN.")])
    if inputs.provider_state == "INVALID":
        return RiskFamilyAssessment(RiskFamily.PROVIDER, RiskState.HARD_VETO, [ReasonCode("PROVIDER_INVALID", -1, "Provider reports INVALID (e.g. bad credentials) -- cannot safely take new risk.")])
    if inputs.provider_state not in policy.provider_required_states:
        return RiskFamilyAssessment(RiskFamily.PROVIDER, RiskState.HOLD_ONLY, [ReasonCode("PROVIDER_STATE_INSUFFICIENT", -1, f"provider_state={inputs.provider_state} not in required {sorted(policy.provider_required_states)}.")])
    return RiskFamilyAssessment(RiskFamily.PROVIDER, RiskState.ALLOW_FULL, [ReasonCode("PROVIDER_OK", 1, f"provider_state={inputs.provider_state}")])


def _system(inputs: AegisInputs) -> RiskFamilyAssessment:
    stress_states = [inputs.stress_gap_detected, inputs.stress_iv_shock_detected, inputs.stress_spread_widening_detected]
    if any(state is None for state in stress_states):
        return RiskFamilyAssessment(RiskFamily.SYSTEM, RiskState.HOLD_ONLY, [ReasonCode("SYSTEM_STRESS_STATE_UNKNOWN", -1, "One or more system stress inputs are UNKNOWN.")])
    stress_count = sum(bool(state) for state in stress_states)
    if stress_count >= 2:
        return RiskFamilyAssessment(RiskFamily.SYSTEM, RiskState.HOLD_ONLY, [ReasonCode("COMPOUND_STRESS_DETECTED", -1, f"{stress_count} simultaneous stress signals detected.")])
    if stress_count == 1:
        return RiskFamilyAssessment(RiskFamily.SYSTEM, RiskState.ALLOW_REDUCED, [ReasonCode("SINGLE_STRESS_DETECTED", -1, "One stress signal detected (gap/IV shock/spread widening).")])
    return RiskFamilyAssessment(RiskFamily.SYSTEM, RiskState.ALLOW_FULL, [ReasonCode("SYSTEM_OK", 1, "No stress signals detected.")])


def assess_aegis(policy: AegisPolicy, inputs: AegisInputs) -> AegisAssessment:
    families = [
        _per_trade(inputs),
        _threshold_assessment(RiskFamily.UNDERLYING, inputs.ticker_concentration_pct, policy.max_ticker_concentration_pct),
        _threshold_assessment(RiskFamily.SECTOR, inputs.sector_concentration_pct, policy.max_sector_concentration_pct),
        _threshold_assessment(RiskFamily.CORRELATION, inputs.correlation_cluster_exposure_pct, policy.max_correlation_cluster_pct),
        _threshold_assessment(RiskFamily.PORTFOLIO, inputs.portfolio_capital_at_risk_pct, policy.max_portfolio_capital_at_risk_pct),
        _threshold_assessment(RiskFamily.INVENTORY, inputs.inventory_capacity_used_pct, policy.max_inventory_capacity_pct),
        _threshold_assessment(RiskFamily.ASSIGNMENT, inputs.assignment_capacity_used_pct, policy.max_assignment_capacity_pct),
        _threshold_assessment(RiskFamily.RECOVERY, inputs.recovery_capacity_used_pct, policy.max_recovery_capacity_pct),
        _liquidity(inputs),
        _execution(inputs),
        _provider(policy, inputs),
        _system(inputs),
    ]
    new_risk_state = RiskState.ALLOW_FULL
    for assessment in families:
        new_risk_state = _worse(new_risk_state, assessment.state)

    reasons = [r for f in families if f.state != RiskState.ALLOW_FULL for r in f.reasons]
    if not reasons:
        reasons = [ReasonCode("ALL_FAMILIES_ALLOW_FULL", 1, "No risk family restricts new risk.")]

    return AegisAssessment(families=families, new_risk_state=new_risk_state, reasons=reasons)


# ---------------------------------------------------------------------------
# Exit supremacy: the mandatory action-permission matrix.
# ---------------------------------------------------------------------------

# Risk-REDUCING actions are always permitted, regardless of new_risk_state --
# a restrictive state (HOLD_ONLY, HARD_VETO, or anything else) must never
# prevent a legitimate close/cancel/reconciliation/safety action.
RISK_REDUCING_ACTIONS: FrozenSet[str] = frozenset({
    "CLOSE",
    "CANCEL",
    "BUY_TO_CLOSE",
    "RECONCILE",
    "REDUCE_POSITION",
    "SAFETY_EXIT",
})

# New-risk-OPENING actions permitted per state, beyond RISK_REDUCING_ACTIONS.
_NEW_RISK_ACTIONS_BY_STATE = {
    RiskState.ALLOW_FULL: frozenset({"OPEN_CSP", "SELL_CC", "ROLL", "OPEN_DEFINED_RISK_SPREAD"}),
    RiskState.ALLOW_REDUCED: frozenset({"OPEN_CSP_REDUCED", "SELL_CC", "ROLL"}),
    RiskState.DEFINED_RISK_ONLY: frozenset({"OPEN_DEFINED_RISK_SPREAD"}),
    RiskState.HOLD_ONLY: frozenset(),
    RiskState.HARD_VETO: frozenset(),
}


def is_action_permitted(state: RiskState, action: str) -> bool:
    """Exit supremacy: a risk-reducing action is ALWAYS permitted, regardless
    of ``state``. Only new-risk-opening actions are gated by state, per the
    explicit allowlist above -- there is no other code path to permission.
    """
    if action in RISK_REDUCING_ACTIONS:
        return True
    return action in _NEW_RISK_ACTIONS_BY_STATE.get(state, frozenset())


def permitted_actions_for(state: RiskState) -> FrozenSet[str]:
    """The full permitted-action set for ``state``: every risk-reducing
    action (always permitted, per exit supremacy) plus whatever new-risk
    actions this state allows. Public accessor for callers (e.g.
    runtime/aegis_contract.py) that need to serialize the whole set rather
    than test one action at a time via :func:`is_action_permitted` -- reads
    the same two tables ``is_action_permitted`` does, so the two can never
    silently disagree."""
    return RISK_REDUCING_ACTIONS | _NEW_RISK_ACTIONS_BY_STATE.get(state, frozenset())
