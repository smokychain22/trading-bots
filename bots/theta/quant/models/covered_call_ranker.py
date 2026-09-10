"""Covered-call ranker (Phase 2B-quant): CC candidate frontier.

Implements the CCUtility formula (docs/quant/phase2/FORMULA_REGISTRY.md,
H-C-01 RETAIN) over a frontier of WAIT / SELL_STOCK / SELL_CC(candidates).
Never sells a call simply because shares exist -- WAIT (retain full stock
upside) is the default when no alternative has a known, superior utility
(H-C-02, RETAIN). Never selects by max yield alone: this ranker compares
full utility (premium minus forfeited upside minus event/tail/execution
cost), which is what makes it structurally different from BC-1's naive
max-yield policy.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence

from models.common import ReasonCode


@dataclass(frozen=True)
class CoveredCallPolicy:
    policy_version: str
    execution_cost_per_contract: float


@dataclass(frozen=True)
class CoveredCallCandidate:
    strike: float
    dte: int
    credit_per_share: Optional[float]
    multiplier: float
    call_away_regret_per_share: Optional[float]  # forfeited upside if called away -- externally estimated
    event_risk_penalty: Optional[float]  # e.g. near-earnings/ex-div penalty, externally supplied; 0.0 if genuinely none


@dataclass(frozen=True)
class StockRetainedContext:
    shares: float
    economic_basis_per_share: float
    current_price_per_share: Optional[float]
    stock_ev_if_uncapped: Optional[float]  # expected forward stock value with no call sold, externally supplied


@dataclass(frozen=True)
class CandidateValuation:
    label: str
    utility: Optional[float]
    reasons: List[ReasonCode]


@dataclass(frozen=True)
class CoveredCallDecision:
    valuations: List[CandidateValuation]
    selected_label: str
    selected_reasons: List[ReasonCode]


def _cc_utility(
    policy: CoveredCallPolicy, candidate: CoveredCallCandidate
) -> CandidateValuation:
    label = f"SELL_CC@{candidate.strike}/{candidate.dte}"
    reasons: List[ReasonCode] = []
    if candidate.credit_per_share is None:
        reasons.append(ReasonCode("CC_QUOTE_UNKNOWN", -1, "Credit quote is UNKNOWN, not assumed favorable."))
        return CandidateValuation(label=label, utility=None, reasons=reasons)
    if candidate.call_away_regret_per_share is None:
        reasons.append(ReasonCode(
            "CALL_AWAY_REGRET_UNKNOWN", -1,
            "CallAwayRegret must come from the actual post-call-away path -- never omitted or defaulted to zero.",
        ))
        return CandidateValuation(label=label, utility=None, reasons=reasons)
    ev_premium = candidate.credit_per_share * candidate.multiplier
    call_away_regret = candidate.call_away_regret_per_share * candidate.multiplier
    event_penalty = candidate.event_risk_penalty if candidate.event_risk_penalty is not None else 0.0
    utility = ev_premium - call_away_regret - event_penalty - policy.execution_cost_per_contract
    reasons.append(ReasonCode("CC_VALUED", 0, f"utility={utility}"))
    return CandidateValuation(label=label, utility=utility, reasons=reasons)


def rank_covered_call_frontier(
    policy: CoveredCallPolicy,
    candidates: Sequence[CoveredCallCandidate],
    stock: StockRetainedContext,
) -> CoveredCallDecision:
    valuations: List[CandidateValuation] = []

    wait_reasons = [ReasonCode("WAIT_VALUED", 0, "WAIT retains full stock upside; no call sold.")]
    wait_utility = stock.stock_ev_if_uncapped
    if wait_utility is None:
        wait_reasons.append(ReasonCode("STOCK_FORWARD_VALUE_UNKNOWN", -1, "No forward stock-value estimate supplied."))
    valuations.append(CandidateValuation(label="WAIT", utility=wait_utility, reasons=wait_reasons))

    sell_stock_reasons = [ReasonCode("SELL_STOCK_VALUED", 0, "Realizes the current mark now, ends further stock exposure.")]
    sell_stock_utility = (
        (stock.current_price_per_share - stock.economic_basis_per_share) * stock.shares
        if stock.current_price_per_share is not None
        else None
    )
    if sell_stock_utility is None:
        sell_stock_reasons.append(ReasonCode("CURRENT_PRICE_UNKNOWN", -1, "Current price is UNKNOWN, not assumed favorable."))
    valuations.append(CandidateValuation(label="SELL_STOCK", utility=sell_stock_utility, reasons=sell_stock_reasons))

    for candidate in candidates:
        valuations.append(_cc_utility(policy, candidate))

    best = valuations[0]
    for valuation in valuations[1:]:
        if valuation.utility is None:
            continue
        if best.utility is None or valuation.utility > best.utility:
            best = valuation

    reasons = list(best.reasons)
    if best.label == "WAIT":
        reasons.append(ReasonCode(
            "WAIT_SELECTED_AS_DEFAULT", 0,
            "No alternative had a known utility exceeding WAIT -- never selling a call merely because shares exist.",
        ))
    return CoveredCallDecision(valuations=valuations, selected_label=best.label, selected_reasons=reasons)
