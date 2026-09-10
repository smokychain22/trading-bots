"""Assignment model (Phase 2B-quant): assignment-aware acceptance economics.

Formalizes whether accepting an impending CSP assignment is preferable to
mechanically closing the CSP beforehand to avoid it -- H-A-01 (RETAIN):
assignment is never automatically failure or success.

This module does NOT fit P(assignment) from data -- no historical dataset
exists yet (Phase 6 gate). It consumes an already-computed assignment
probability as an external input (e.g. theta_h_baseline.py's
assignment_probability_proxy, or a future fitted model) where useful for
context, and it computes the ACCEPTANCE-ECONOMICS decision from
ownership/severe-drawdown inputs this repository already has models for
(ownership_v0.py, severe_drawdown_spec.py). No I/O, no provider dependency.
"""

from dataclasses import dataclass
from typing import List, Optional

from models.common import ReasonCode


@dataclass(frozen=True)
class AssignmentPolicy:
    policy_version: str
    ownership_acceptability_floor: float
    tail_risk_penalty_weight: float


@dataclass(frozen=True)
class AssignmentCandidateInputs:
    strike: float
    multiplier: float
    entry_premium_per_share: float
    ownership_acceptability: Optional[float]
    p_severe_drawdown: Optional[float]
    mechanical_close_debit_per_share: Optional[float]  # BTC cost right now, to avoid assignment (BA-1's alternative)
    capital_committed: float


@dataclass(frozen=True)
class AssignmentEconomics:
    economic_basis_per_share: float  # strike - entry_premium_per_share (ASSIGNMENT_ECONOMIC_BASIS, recovery_spec.py)
    mechanical_close_realized_pnl: Optional[float]  # what BA-1 (mechanical close-before-assignment) would realize
    accept_assignment_tail_penalty: Optional[float]


@dataclass(frozen=True)
class AssignmentEvaluation:
    ownership_acceptable: Optional[bool]  # None if UNKNOWN
    economics: AssignmentEconomics
    recommendation: str  # "ACCEPT_ASSIGNMENT" | "CLOSE_STOCK" | "UNKNOWN"
    reasons: List[ReasonCode]


def evaluate_assignment(policy: AssignmentPolicy, c: AssignmentCandidateInputs) -> AssignmentEvaluation:
    reasons: List[ReasonCode] = []
    economic_basis = c.strike - c.entry_premium_per_share

    mechanical_close_pnl = (
        (c.entry_premium_per_share - c.mechanical_close_debit_per_share) * c.multiplier
        if c.mechanical_close_debit_per_share is not None
        else None
    )
    tail_penalty = (
        policy.tail_risk_penalty_weight * c.p_severe_drawdown * c.capital_committed
        if c.p_severe_drawdown is not None
        else None
    )
    economics = AssignmentEconomics(
        economic_basis_per_share=economic_basis,
        mechanical_close_realized_pnl=mechanical_close_pnl,
        accept_assignment_tail_penalty=tail_penalty,
    )

    if c.ownership_acceptability is None:
        reasons.append(ReasonCode("OWNERSHIP_UNKNOWN", -1, "ownership_acceptability is UNKNOWN -- cannot recommend acceptance."))
        return AssignmentEvaluation(ownership_acceptable=None, economics=economics, recommendation="UNKNOWN", reasons=reasons)

    ownership_acceptable = c.ownership_acceptability >= policy.ownership_acceptability_floor
    if not ownership_acceptable:
        reasons.append(ReasonCode(
            "OWNERSHIP_BELOW_FLOOR", -1,
            f"ownership_acceptability={c.ownership_acceptability} below floor {policy.ownership_acceptability_floor}.",
        ))
        if mechanical_close_pnl is None:
            reasons.append(ReasonCode("MECHANICAL_CLOSE_QUOTE_UNKNOWN", -1, "Cannot confirm mechanical close is feasible."))
            return AssignmentEvaluation(ownership_acceptable=False, economics=economics, recommendation="UNKNOWN", reasons=reasons)
        reasons.append(ReasonCode("CLOSE_STOCK_RECOMMENDED", 0, "Ownership unacceptable -- mechanically close before assignment."))
        return AssignmentEvaluation(ownership_acceptable=False, economics=economics, recommendation="CLOSE_STOCK", reasons=reasons)

    reasons.append(ReasonCode("OWNERSHIP_ACCEPTABLE", 1, f"ownership_acceptability={c.ownership_acceptability}"))
    if tail_penalty is None:
        reasons.append(ReasonCode("TAIL_RISK_UNKNOWN", -1, "p_severe_drawdown is UNKNOWN -- cannot confirm acceptance is safe."))
        return AssignmentEvaluation(ownership_acceptable=True, economics=economics, recommendation="UNKNOWN", reasons=reasons)

    reasons.append(ReasonCode(
        "ACCEPT_ASSIGNMENT_RECOMMENDED", 1,
        "Ownership-acceptable and tail risk known -- assignment need not be mechanically avoided (H-A-01).",
    ))
    return AssignmentEvaluation(ownership_acceptable=True, economics=economics, recommendation="ACCEPT_ASSIGNMENT", reasons=reasons)
