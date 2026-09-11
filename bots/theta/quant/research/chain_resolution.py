"""Chain resolution/censoring classification for THETA replay/research (R6).

An economic chain (short put -> roll -> expiration -> assignment ->
recovery -> covered call -> call-away/closure) is either fully resolved,
still open (censored), contaminated by activity outside THETA's own
management, or built from data too broken to trust at all. These are
FOUR genuinely different situations, and conflating any pair of them
would corrupt the training/evaluation dataset:

- An open chain must never be scored as a terminal win or loss (H-A-01/
  the standing "assignment is never automatically a win" discipline,
  generalized to the whole chain).
- A chain contaminated by activity THETA itself never decided (a manual
  trade placed outside the bot, a corporate action THETA's own models
  never saw) must never be blended into the same labeled population as a
  chain THETA's own policy fully controlled -- its outcome reflects
  something other than the policy under evaluation.
- A chain built from genuinely invalid/inconsistent data (a negative
  share count, a fee event referencing a lot that doesn't exist) must
  never silently become RESOLVED with whatever numbers happen to fall
  out of the arithmetic.

No I/O, no provider dependency -- pure classification over already-
computed ledger/reconciliation facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from models.common import ReasonCode


class ChainResolutionStatus(str, Enum):
    RESOLVED = "RESOLVED"
    CENSORED_OPEN = "CENSORED_OPEN"
    INVALID_DATA = "INVALID_DATA"
    EXTERNAL_ACTIVITY_CONTAMINATED = "EXTERNAL_ACTIVITY_CONTAMINATED"


@dataclass(frozen=True)
class ChainResolutionInputs:
    # From ledger-contract.ts's WholeChainPnlBreakdown, already computed:
    has_unresolved_open_positions: bool
    whole_chain_pnl_known: bool  # wholeChainPnl is not null
    valuation_issues: List[str]  # echoed for audit, e.g. ["STOCK_MARK_UNAVAILABLE"]
    # Data-integrity facts, from whatever validated the ledger rows
    # themselves (e.g. a reconciliation pass) -- never assumed true:
    data_integrity_valid: bool
    data_integrity_issues: List[str]
    # Whether reconciliation detected any broker activity on this chain's
    # positions that THETA's own policy never proposed/authorized (a
    # manual override, a non-THETA order on the same account/symbol) --
    # never inferred, only reported when a real reconciliation pass
    # actually found one:
    external_activity_detected: bool
    external_activity_detail: Optional[str]


@dataclass(frozen=True)
class ChainResolutionResult:
    status: ChainResolutionStatus
    reasons: List[ReasonCode]


def classify_chain_resolution(inputs: ChainResolutionInputs) -> ChainResolutionResult:
    """Precedence, most-authoritative-fact first: invalid data can make
    even a chain that LOOKS resolved untrustworthy, so it is checked
    before anything else. External contamination is checked next because
    it invalidates the chain's evidentiary value regardless of whether
    the numbers themselves are internally consistent. Only after both are
    ruled out does open-vs-resolved become the deciding question."""
    reasons: List[ReasonCode] = []

    if not inputs.data_integrity_valid:
        reasons.extend(ReasonCode(f"DATA_INTEGRITY_ISSUE:{issue}", -1, "Chain data failed an integrity check.") for issue in inputs.data_integrity_issues)
        if not inputs.data_integrity_issues:
            reasons.append(ReasonCode("DATA_INTEGRITY_ISSUE:UNSPECIFIED", -1, "Chain data marked invalid with no specific issue recorded."))
        return ChainResolutionResult(status=ChainResolutionStatus.INVALID_DATA, reasons=reasons)

    if inputs.external_activity_detected:
        reasons.append(ReasonCode(
            "EXTERNAL_ACTIVITY_DETECTED", -1,
            inputs.external_activity_detail or "Reconciliation detected broker activity THETA's own policy did not authorize.",
        ))
        return ChainResolutionResult(status=ChainResolutionStatus.EXTERNAL_ACTIVITY_CONTAMINATED, reasons=reasons)

    if inputs.has_unresolved_open_positions or not inputs.whole_chain_pnl_known:
        reasons.append(ReasonCode(
            "CHAIN_STILL_OPEN" if inputs.has_unresolved_open_positions else "WHOLE_CHAIN_PNL_UNKNOWN",
            0,
            "Chain has an unresolved open position or an unresolved valuation component -- censored, never scored as a terminal outcome.",
        ))
        for issue in inputs.valuation_issues:
            reasons.append(ReasonCode(f"VALUATION_ISSUE:{issue}", 0, "Named valuation gap carried through from computeWholeChainPnl."))
        return ChainResolutionResult(status=ChainResolutionStatus.CENSORED_OPEN, reasons=reasons)

    reasons.append(ReasonCode("CHAIN_FULLY_RESOLVED", 1, "Every leg/lot closed, every valuation component known, no contamination or integrity issue detected."))
    return ChainResolutionResult(status=ChainResolutionStatus.RESOLVED, reasons=reasons)
