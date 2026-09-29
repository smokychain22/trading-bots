"""D (THETA_DEFINED_RISK) two-leg spread economics -- Claude-owned quant
fixture (THETA long-run build, work package 32).

Real search performed before writing this module: no Python-side D
economics module existed anywhere in `bots/theta/quant/models/` (Q has
`theta_q_baseline.py`, H has `theta_h_baseline.py`, C has
`covered_call_ranker.py`, A has `recovery_decision.py`/`recovery_spec.py`
-- all real, pre-existing, tested; D had none). The REAL canonical D
formula already exists on the Codex-owned TypeScript side
(`src/theta/canonical-strategy-frontier.ts`'s `definedRiskCandidate()`):
`width = shortPut.strike - longPut.strike`,
`netCredit = shortPut.bid - longPut.ask`,
`maxProfit = netCredit * multiplier`, `maxLoss = (width - netCredit) *
multiplier`, with hard blockers for invalid width, mismatched expiration/
multiplier, and non-positive net credit.

This module reproduces that EXACT formula (never a divergent one) as a
Claude-owned mathematical fixture, per the master command's own division
of labor (section 57): "If Codex TS implementation fails fixture: write
exact failing case and handoff. Do not rewrite Codex-owned app layer."
It ADDS per-leg fees/slippage (genuinely absent from the canonical TS
formula as read) as an explicit, separate, additive net-of-cost view --
never silently folded into `max_profit`/`max_loss`, which remain GROSS by
convention, matching every other module in this repo's cost-accounting
discipline (`theta_q_baseline.py`'s `CandidateEconomics`).
"""

from dataclasses import dataclass
from typing import List, Optional

from models.common import ReasonCode


@dataclass(frozen=True)
class DefinedRiskLegInputs:
    strike: float
    bid: Optional[float]
    ask: Optional[float]
    expiration: str
    multiplier: int


@dataclass(frozen=True)
class DefinedRiskCostAssumptions:
    commission_per_contract: float
    fees_per_contract: float
    est_slippage_per_contract: float
    cost_model_version: str


@dataclass(frozen=True)
class DefinedRiskEconomics:
    width: float
    net_credit: Optional[float]
    max_profit: float  # gross, matches canonical-strategy-frontier.ts's convention exactly
    max_loss: float  # gross
    # Additive, never folded into the gross figures above:
    total_fees_both_legs: float
    total_commission_both_legs: float
    total_slippage_both_legs: float
    net_credit_after_cost: Optional[float]
    hard_blockers: List[str]


def compute_defined_risk_economics(
    short_leg: DefinedRiskLegInputs, long_leg: DefinedRiskLegInputs, costs: DefinedRiskCostAssumptions,
) -> DefinedRiskEconomics:
    hard_blockers: List[str] = []
    width = short_leg.strike - long_leg.strike
    if not (width > 0):
        hard_blockers.append("INVALID_SPREAD_WIDTH")
    if short_leg.expiration != long_leg.expiration:
        hard_blockers.append("MISMATCHED_EXPIRATION")
    if short_leg.multiplier != long_leg.multiplier:
        hard_blockers.append("MISMATCHED_MULTIPLIER")

    net_credit: Optional[float] = None
    if short_leg.bid is not None and long_leg.ask is not None:
        net_credit = short_leg.bid - long_leg.ask
    else:
        hard_blockers.append("MULTI_LEG_PRICE_UNKNOWN")
    if net_credit is not None and net_credit <= 0:
        hard_blockers.append("NON_POSITIVE_NET_CREDIT")

    multiplier = short_leg.multiplier
    max_profit = 0.0 if net_credit is None else net_credit * multiplier
    max_loss = 0.0 if net_credit is None else (width - net_credit) * multiplier

    # Both legs incur their own real cost -- never a single-leg shortcut.
    total_commission_both_legs = costs.commission_per_contract * 2
    total_fees_both_legs = costs.fees_per_contract * 2
    total_slippage_both_legs = costs.est_slippage_per_contract * 2
    net_credit_after_cost = (
        None if net_credit is None
        else net_credit - (total_commission_both_legs + total_fees_both_legs + total_slippage_both_legs) / multiplier
    )

    return DefinedRiskEconomics(
        width=width, net_credit=net_credit, max_profit=max_profit, max_loss=max_loss,
        total_fees_both_legs=total_fees_both_legs, total_commission_both_legs=total_commission_both_legs,
        total_slippage_both_legs=total_slippage_both_legs, net_credit_after_cost=net_credit_after_cost,
        hard_blockers=hard_blockers,
    )


def defined_risk_payoff_at_expiration(
    underlying_price_at_expiration: float, short_strike: float, long_strike: float,
    net_credit: float, multiplier: int,
) -> float:
    """The P&L at expiration for a real short-put/long-put defined-risk
    spread, at a given underlying price -- a true payoff-curve point, not
    an approximation. Both legs' intrinsic value are computed explicitly;
    this never collapses to a single-leg shortcut.
    """
    short_intrinsic = max(0.0, short_strike - underlying_price_at_expiration)
    long_intrinsic = max(0.0, long_strike - underlying_price_at_expiration)
    # We are short the short_strike put (we owe its intrinsic value) and
    # long the long_strike put (it pays us its intrinsic value).
    return (net_credit - short_intrinsic + long_intrinsic) * multiplier
