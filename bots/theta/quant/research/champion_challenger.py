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
    DEGRADED = "DEGRADED"  # R6F: was CHAMPION/CHALLENGER and still passes the promotion checklist, but a health-drift signal (EV/calibration/tail/execution/feature/regime drift) has been detected -- a research-side de-rating recommendation, per THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0 section 37's health ladder
    HOLD_ONLY = "HOLD_ONLY"  # R6F: a SEVERE health-drift signal on a previously CHAMPION/CHALLENGER branch -- research recommends no new risk on this branch, existing positions only; a stronger de-rating than DEGRADED, still short of RETIRED
    RESEARCH_ONLY = "RESEARCH_ONLY"  # has not yet passed its own promotion checklist -- may be studied/backtested, never routed live
    RETIRED = "RETIRED"  # was previously CHAMPION/CHALLENGER but a later promotion re-check failed (regression, drift, or a newer challenger definitively superseded it)


@dataclass(frozen=True)
class BranchPromotionRecord:
    strategy_family: StrategyFamily
    latest_promotion_result: PromotionResult
    previously_was_champion_or_challenger: bool
    human_activation_confirmed: bool  # Codex/owner's own Production activation decision -- this module NEVER sets this true itself
    health_drift_detected: bool = False  # R6F: any of EV/calibration/tail/drawdown/execution/feature/regime drift observed, per spec section 37
    severe_health_drift: bool = False  # R6F: the drift is severe enough to recommend HOLD_ONLY rather than merely DEGRADED -- caller's own judgment call, never invented here


def determine_branch_status(record: BranchPromotionRecord) -> BranchStatus:
    """Derives a branch's status from its OWN promotion evidence and health-
    drift signal only -- never from another branch's performance. A branch
    that regresses from a prior PROMOTION_ELIGIBLE_RESEARCH result to any
    failure class is RETIRED, not silently reset to RESEARCH_ONLY
    (retirement is a stronger, more visible signal that something that used
    to work stopped working -- worth surfacing distinctly from "never
    validated at all"). This function only ever RECOMMENDS a status; it
    never activates or deactivates anything in Production -- that remains
    Codex's sole decision (spec section 37: "This research module may
    recommend state changes. It may NOT activate Production changes")."""
    if record.latest_promotion_result != PromotionResult.PROMOTION_ELIGIBLE_RESEARCH:
        if record.previously_was_champion_or_challenger:
            return BranchStatus.RETIRED
        return BranchStatus.RESEARCH_ONLY

    if record.severe_health_drift and record.previously_was_champion_or_challenger:
        return BranchStatus.HOLD_ONLY
    if record.health_drift_detected and record.previously_was_champion_or_challenger:
        return BranchStatus.DEGRADED

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
    """The families actually eligible to be ROUTED for NEW risk (by
    `strategy_router.py`'s own eligibility check, which still applies on
    top of this) -- RESEARCH_ONLY, HOLD_ONLY, and RETIRED families are
    excluded here regardless of what `route_strategies` would say about
    this cycle's lifecycle/market state, since a family that hasn't earned
    (or has lost) graduation cannot compete for new risk no matter how
    eligible this specific cycle looks. DEGRADED is INCLUDED -- degraded
    still means "may continue, at reduced confidence," distinct from
    HOLD_ONLY's "no new risk on this branch at all.\""""
    return [family for family, status in statuses.items() if status in (BranchStatus.CHAMPION, BranchStatus.CHALLENGER, BranchStatus.DEGRADED)]
