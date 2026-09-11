"""Champion/challenger strategy-family routing research (R6E).

Answers a DIFFERENT question than `models/strategy_router.py`'s
`route_strategies`. That module answers "given the current lifecycle/
market state, which families may compete THIS CYCLE" (eligibility). This
module answers "has this family EARNED graduation from research-only status
at all" -- a slower-moving, evidence-based status that gates whether a
family may EVER be routed as CHAMPION, independent of any single cycle's
eligibility. No branch is ever activated simply because another branch
found no eligible/positive-EV candidate this cycle -- that would be
exactly the "strategy A lost today -> switch to strategy B" anti-pattern
R6E explicitly rejects.

No I/O, no provider dependency -- pure functions over caller-supplied
promotion evidence, exercised only against synthetic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List

from models.strategy_router import StrategyFamily
from research.promotion_checker import PromotionResult


class BranchStatus(str, Enum):
    CHAMPION = "CHAMPION"  # graduated: PROMOTION_ELIGIBLE_RESEARCH on its own promotion checklist AND explicitly activated by the human/Codex-owned Production decision (this module never performs that activation itself)
    CHALLENGER = "CHALLENGER"  # PROMOTION_ELIGIBLE_RESEARCH but not yet activated, OR activated in a reduced/shadow capacity
    RESEARCH_ONLY = "RESEARCH_ONLY"  # has not yet passed its own promotion checklist -- may be studied/backtested, never routed live
    RETIRED = "RETIRED"  # was previously CHAMPION/CHALLENGER but a later promotion re-check failed (regression, drift, or a newer challenger definitively superseded it)


@dataclass(frozen=True)
class BranchPromotionRecord:
    strategy_family: StrategyFamily
    latest_promotion_result: PromotionResult
    previously_was_champion_or_challenger: bool
    human_activation_confirmed: bool  # Codex/owner's own Production activation decision -- this module NEVER sets this true itself


def determine_branch_status(record: BranchPromotionRecord) -> BranchStatus:
    """Derives a branch's status from its OWN promotion evidence only --
    never from another branch's performance. A branch that regresses from
    a prior PROMOTION_ELIGIBLE_RESEARCH result to any failure class is
    RETIRED, not silently reset to RESEARCH_ONLY (retirement is a stronger,
    more visible signal that something that used to work stopped
    working -- worth surfacing distinctly from "never validated at all")."""
    if record.latest_promotion_result != PromotionResult.PROMOTION_ELIGIBLE_RESEARCH:
        if record.previously_was_champion_or_challenger:
            return BranchStatus.RETIRED
        return BranchStatus.RESEARCH_ONLY

    if record.human_activation_confirmed:
        return BranchStatus.CHAMPION
    return BranchStatus.CHALLENGER


def route_champion_challenger(records: Dict[StrategyFamily, BranchPromotionRecord]) -> Dict[StrategyFamily, BranchStatus]:
    """Computes every registered family's status independently. A family's
    status here is NEVER influenced by another family's -- there is no
    aggregate/relative comparison in this function at all, by construction,
    which is what makes "no branch activated just because another found
    nothing" a structural property rather than a discipline someone has to
    remember to apply at the call site."""
    return {family: determine_branch_status(record) for family, record in records.items()}


def champions_and_challengers(statuses: Dict[StrategyFamily, BranchStatus]) -> List[StrategyFamily]:
    """The families actually eligible to be ROUTED (by
    `strategy_router.py`'s own eligibility check, which still applies on
    top of this) -- RESEARCH_ONLY and RETIRED families are excluded here
    regardless of what `route_strategies` would say about this cycle's
    lifecycle/market state, since a family that hasn't earned graduation
    cannot compete live no matter how eligible this specific cycle looks."""
    return [family for family, status in statuses.items() if status in (BranchStatus.CHAMPION, BranchStatus.CHALLENGER)]
