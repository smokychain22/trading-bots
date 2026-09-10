"""Position sizing model (Phase 2C-quant).

Computes final contract quantity as the tightest of every independently
versioned cap, transformed by the AEGIS risk state
(docs/quant/phase2/AEGIS_SIZING_EXECUTION_CONTRACT.md §3). ``final_qty = 0``
is a legitimate, expected, and frequently correct outcome -- NEVER
``max(1, qty)``. No martingale/loss-doubling sizing under any circumstance:
this module never increases size in response to recent losses, and has no
input through which a caller could smuggle loss-conditioned scaling in.
"""

from dataclasses import dataclass
from typing import List, Optional

from models.aegis import RiskState
from models.common import ReasonCode


@dataclass(frozen=True)
class SizingPolicy:
    policy_version: str
    risk_budget_qty_cap: int
    collateral_qty_cap: int
    concentration_qty_cap: int
    assignment_capacity_qty_cap: int
    reduced_state_multiplier: float  # applied only under ALLOW_REDUCED, e.g. 0.5 -- required, not defaulted


@dataclass(frozen=True)
class SizingInputs:
    equity: Optional[float]
    cash: Optional[float]
    buying_power: Optional[float]
    required_collateral_per_contract: Optional[float]
    broker_allowed_qty: int
    risk_state: RiskState


@dataclass(frozen=True)
class SizingResult:
    quantity: int
    capital_required: Optional[float]
    binding_constraint: str
    reasons: List[ReasonCode]


def compute_sizing(policy: SizingPolicy, inputs: SizingInputs) -> SizingResult:
    reasons: List[ReasonCode] = []

    if inputs.risk_state in (RiskState.HOLD_ONLY, RiskState.HARD_VETO):
        reasons.append(ReasonCode(
            "AEGIS_BLOCKS_NEW_RISK", -1,
            f"risk_state={inputs.risk_state.value} does not permit any new-risk sizing.",
        ))
        return SizingResult(quantity=0, capital_required=None, binding_constraint="AEGIS", reasons=reasons)

    if inputs.buying_power is None or inputs.required_collateral_per_contract is None:
        reasons.append(ReasonCode(
            "SIZING_INPUT_UNKNOWN", -1,
            "buying_power/required_collateral is UNKNOWN -- quantity cannot be confirmed positive, sizing to zero.",
        ))
        return SizingResult(quantity=0, capital_required=None, binding_constraint="UNKNOWN_INPUT", reasons=reasons)

    if inputs.required_collateral_per_contract <= 0:
        reasons.append(ReasonCode("INVALID_COLLATERAL", -1, "required_collateral_per_contract must be > 0."))
        return SizingResult(quantity=0, capital_required=None, binding_constraint="INVALID_INPUT", reasons=reasons)

    collateral_affordable_qty = int(inputs.buying_power // inputs.required_collateral_per_contract)

    caps = {
        "RISK_BUDGET": policy.risk_budget_qty_cap,
        "COLLATERAL_CAP": policy.collateral_qty_cap,
        "CONCENTRATION_CAP": policy.concentration_qty_cap,
        "ASSIGNMENT_CAPACITY_CAP": policy.assignment_capacity_qty_cap,
        "BUYING_POWER_AFFORDABLE": collateral_affordable_qty,
        "BROKER_ALLOWED": inputs.broker_allowed_qty,
    }
    binding_constraint = min(caps, key=lambda name: caps[name])
    raw_qty = max(caps[binding_constraint], 0)

    if inputs.risk_state == RiskState.ALLOW_REDUCED:
        reduced_qty = int(raw_qty * policy.reduced_state_multiplier)
        if reduced_qty < raw_qty:
            binding_constraint = "AEGIS_ALLOW_REDUCED"
        raw_qty = reduced_qty

    capital_required = raw_qty * inputs.required_collateral_per_contract
    reasons.append(ReasonCode("SIZING_COMPUTED", 0, f"quantity={raw_qty} binding_constraint={binding_constraint}"))
    if raw_qty == 0:
        reasons.append(ReasonCode("QUANTITY_ZERO", 0, "Quantity zero is a valid, expected sizing outcome -- never floored to 1."))

    return SizingResult(quantity=raw_qty, capital_required=capital_required, binding_constraint=binding_constraint, reasons=reasons)
