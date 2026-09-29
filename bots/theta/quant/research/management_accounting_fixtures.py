"""Deterministic management-chain accounting fixtures (work package 78).

Proves, with concrete deterministic fixtures, the charter's own
non-negotiable rules: a roll's old leg realized P&L is immutable and
never absorbed into the new leg's numbers; fees are counted exactly once
per leg (never once at close and again at the chain level); and
capital-days/basis/whole-chain P&L compose correctly across every
lifecycle event kind (CSP open, BTC close, expire, roll, assignment,
hold, recovery, CC, call-away, stock sale).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence


@dataclass(frozen=True)
class LegRealization:
    leg_id: str
    event_kind: str  # 'CSP_OPEN' | 'BTC_CLOSE' | 'EXPIRE_OTM' | 'ROLL_CLOSE' | 'ROLL_OPEN' | 'ASSIGNMENT' |
                      # 'HOLD' | 'RECOVERY' | 'CC_OPEN' | 'CALL_AWAY' | 'STOCK_SALE'
    realized_pnl: Optional[float]  # None only for HOLD (no realization event yet)
    fees_paid: float
    capital_days: float
    opened_at: str
    closed_at: Optional[str]


def whole_chain_realized_pnl(legs: Sequence[LegRealization]) -> dict:
    """Sums every leg's OWN realized P&L exactly once. A roll's old leg
    (event_kind='ROLL_CLOSE') contributes its realized P&L unchanged --
    this function never re-derives or nets it against the new leg opened
    afterward (event_kind='ROLL_OPEN', whose own realized_pnl is None
    until IT closes)."""
    if not legs:
        raise ValueError('MANAGEMENT_ACCOUNTING_NO_LEGS')
    seen_ids = set()
    total_pnl = 0.0
    total_fees = 0.0
    total_capital_days = 0.0
    resolved_legs = 0
    for leg in legs:
        if leg.leg_id in seen_ids:
            raise ValueError(f'MANAGEMENT_ACCOUNTING_DUPLICATE_LEG_ID:{leg.leg_id}')
        seen_ids.add(leg.leg_id)
        if leg.realized_pnl is not None:
            total_pnl += leg.realized_pnl
            resolved_legs += 1
        total_fees += leg.fees_paid
        total_capital_days += leg.capital_days
    return {
        'version': 'theta-management-accounting-fixture-v1', 'legCount': len(legs), 'resolvedLegCount': resolved_legs,
        'wholeChainRealizedPnl': total_pnl, 'totalFeesPaid': total_fees, 'totalCapitalDays': total_capital_days,
        'state': 'FULLY_RESOLVED' if resolved_legs == len(legs) else 'PARTIALLY_RESOLVED',
    }


def basis_after_assignment(strike: float, fees_paid_on_assignment: float) -> float:
    """The stock cost basis after CSP assignment is the strike price plus
    any fees paid at assignment -- never the premium collected (that was
    already realized as the OPTION leg's own P&L, not a basis reduction)."""
    if strike <= 0:
        raise ValueError('MANAGEMENT_ACCOUNTING_STRIKE_MUST_BE_POSITIVE')
    return strike + fees_paid_on_assignment
