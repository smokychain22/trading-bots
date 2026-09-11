"""Whole-episode economic invariants for THETA (R6D).

Two invariants the R6D directive named explicitly, made checkable as real
code so no research calculation can silently violate them:

1. ROLL ACCOUNTING: a roll's old-leg realized P&L is immutable and must be
   SUMMED into the whole episode's economics, never absorbed/hidden/
   re-based into the new leg's own reported number.
2. RETURN DENOMINATOR: a short-premium return must never silently divide by
   premium collected and call the result a "return" -- that quantity is
   PremiumCapture, not ReturnOnSecuredCapital/ReturnPerCapitalDay/
   WholeChainReturn, and secured capital must never assume a 100 multiplier
   when the real multiplier is unverified.

No I/O, no provider dependency -- pure functions over caller-supplied
already-realized amounts, exercised only against synthetic fixtures until
real resolved episodes exist (EV_MODEL_NOT_EMPIRICALLY_READY, unchanged).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence


def whole_episode_pnl(leg_realized_pnls: Sequence[float]) -> float:
    """Sums every already-realized leg P&L (original open, every close/roll
    leg, assignment/call-away effects already expressed as a realized
    amount) into the one number that is the episode's true economics.

    A roll is close-old + open-new -- BOTH legs' realized P&L are summed
    here, never netted against each other and reported as if only the net
    credit/debit of the round-trip mattered. Example (the exact one named
    in the R6D directive): original STO +200, BTC -350, new STO +180, later
    BTC -15 -- the whole-episode economics is 200-350+180-15 = +15, never
    +195 (which would silently drop the -350 old-leg loss from the total)."""
    return sum(leg_realized_pnls)


@dataclass(frozen=True)
class SecuredCapitalInputs:
    """Collateral behind a cash-secured short option. `multiplier` is
    REQUIRED and Optional[int] -- None means the real contract multiplier
    is unverified, and secured_capital() must return None (UNKNOWN) rather
    than silently assuming the standard 100-share multiplier. This mirrors
    Codex's own already-integrated fix (`docs/DECISIONS.md`: "unverified
    contract multiplier must produce UNKNOWN economics, never a 100-share
    fallback") -- this module must never regress that discipline on the
    research side."""

    strike: float
    contracts: float
    multiplier: Optional[int]


def secured_capital(inputs: SecuredCapitalInputs) -> Optional[float]:
    if inputs.multiplier is None:
        return None
    if inputs.strike <= 0 or inputs.contracts <= 0 or inputs.multiplier <= 0:
        return None
    return inputs.strike * inputs.contracts * inputs.multiplier


def premium_capture_fraction(premium_collected: float, realized_pnl: float) -> Optional[float]:
    """realized_pnl as a fraction of premium collected -- explicitly named
    PremiumCapture, never called "return" on its own. Returns None
    (never a fabricated ratio) when premium_collected is zero."""
    if premium_collected == 0:
        return None
    return realized_pnl / premium_collected


def return_on_secured_capital(realized_pnl: float, capital: Optional[float]) -> Optional[float]:
    """realized_pnl as a fraction of the capital actually secured/committed
    -- the economically meaningful "return," never premium collected.
    Returns None when capital is unknown or non-positive (e.g. an unverified
    multiplier upstream, per `secured_capital` above)."""
    if capital is None or capital <= 0:
        return None
    return realized_pnl / capital


def return_per_capital_day(realized_pnl: float, capital: Optional[float], capital_days: float) -> Optional[float]:
    """realized_pnl per dollar of committed capital per day it was
    committed -- THETA's canonical capital-efficiency metric
    (`THETA_EV_MODEL_SPEC.md`). Returns None when capital is unknown/non-
    positive or capital_days is non-positive (a position that consumed zero
    capital-days has no rate to report, not a fabricated infinite one)."""
    if capital is None or capital <= 0 or capital_days <= 0:
        return None
    return realized_pnl / (capital * capital_days)


def whole_chain_return(whole_chain_pnl: Optional[float], capital_committed: Optional[float]) -> Optional[float]:
    """The full-cycle (CSP -> assignment -> stock -> CC -> call-away, or any
    subset actually taken) return over the capital committed across the
    entire chain. None propagates from either an unknown whole_chain_pnl
    (per `ledger-contract.ts`'s own null-honest convention) or unknown
    capital -- never silently substituting 0 for either."""
    if whole_chain_pnl is None or capital_committed is None or capital_committed <= 0:
        return None
    return whole_chain_pnl / capital_committed
