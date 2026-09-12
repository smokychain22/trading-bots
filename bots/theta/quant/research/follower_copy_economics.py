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
from typing import List, Optional

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


@dataclass(frozen=True)
class CopyDegradation:
    """Every field measuring how much worse (or better) the follower's
    OWN economics were versus the master's, at the SAME event. Every
    field Optional/None until real Paper/live TCA exists -- never
    fabricated as a fixed assumed degradation."""

    master_fill_price: Optional[float]
    follower_observed_bbo_mid: Optional[float]
    follower_theoretical_limit: Optional[float]
    follower_actual_fill_price: Optional[float]
    follower_fill_delay_seconds: Optional[float]
    price_deterioration_per_unit: Optional[float]  # follower_actual_fill_price - master_fill_price, signed: positive = worse for the follower
    spread_degradation: Optional[float]  # follower's own spread at fill time minus the master's own spread at fill time
    edge_decay: Optional[float]  # modeled_edge_at_master_fill - modeled_edge_at_follower_fill, positive = edge eroded during the copy delay
    return_degradation_pct: Optional[float]  # (follower_return - master_return) / abs(master_return), None if master_return is 0 or unknown


def compute_price_deterioration(master_fill_price: Optional[float], follower_actual_fill_price: Optional[float]) -> Optional[float]:
    if master_fill_price is None or follower_actual_fill_price is None:
        return None
    return follower_actual_fill_price - master_fill_price


@dataclass(frozen=True)
class CopyabilityAssessment:
    decision: CopyDecision
    reasons: List[str]


def assess_copyability(
    inputs: FollowerSizingInputs,
    branch_compatible: bool,
    quote_fresh: bool,
    account_isolation_violations: List[str],
) -> CopyabilityAssessment:
    """Determines whether a master event can be economically replicated
    for this follower AT THIS MOMENT. Never an opaque copy score --
    every non-COPY_ELIGIBLE result carries an explicit reason. A follower
    may SKIP even when the master traded; nothing here assumes the
    follower's economics mirror the master's."""
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

    quantity = compute_follower_quantity(inputs)
    if quantity <= 0:
        reasons.append("FOLLOWER_ACCOUNT_CAPACITY_YIELDS_ZERO_QUANTITY")
        return CopyabilityAssessment(CopyDecision.SKIP, reasons)

    if quantity < inputs.master_quantity:
        reasons.append(f"FOLLOWER_CAPACITY_BINDS_BELOW_MASTER_QUANTITY: {quantity} < {inputs.master_quantity}")
        return CopyabilityAssessment(CopyDecision.COPY_REDUCED, reasons)

    reasons.append("FOLLOWER_CAPACITY_SUPPORTS_FULL_MASTER_QUANTITY")
    return CopyabilityAssessment(CopyDecision.COPY_ELIGIBLE, reasons)
