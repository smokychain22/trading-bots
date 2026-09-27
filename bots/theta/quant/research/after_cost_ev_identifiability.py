"""After-cost EV identifiability (THETA long-run build, work package 38).

`theta_q_baseline.py`'s `CandidateEconomics.ev_net`/`ev_net_unknown_reason`
already exists (checked first) but is a binary None-plus-free-text-reason,
not the explicit `IDENTIFIABLE`/`PARTIAL`/`NOT_IDENTIFIABLE` taxonomy this
work package asks for, and it names no structured missing-component list.
This module is additive, general-purpose research infrastructure usable
by Q/H/D/A/C uniformly (not a change to `theta_q_baseline.py` itself,
which stays as the real, tested, canonical Q producer).

`IDENTIFIABLE` requires every real ingredient to be present: a real
probability estimate, a real gross-outcome-if-favorable, a real
gross-outcome-if-unfavorable, and a real total cost. `PARTIAL` means at
least one ingredient is present but not all. `NOT_IDENTIFIABLE` means
none are present. A missing ingredient is never fabricated -- it is named
in `missing_components`, and no after-cost EV is ever calculated from an
incomplete ingredient set.
"""

from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class AfterCostEvIngredients:
    probability_favorable: Optional[float]  # a real, calibrated probability -- never delta, never a guess
    gross_outcome_if_favorable: Optional[float]
    gross_outcome_if_unfavorable: Optional[float]
    total_cost: Optional[float]
    probability_source: Optional[str]  # e.g. model_id/version -- names WHERE the probability came from


@dataclass(frozen=True)
class AfterCostEvResult:
    identifiability: str  # "IDENTIFIABLE" | "PARTIAL" | "NOT_IDENTIFIABLE"
    after_cost_ev: Optional[float]
    missing_components: List[str]
    probability_source: Optional[str]


def classify_after_cost_ev(ingredients: AfterCostEvIngredients) -> AfterCostEvResult:
    missing = []
    if ingredients.probability_favorable is None:
        missing.append("probability_favorable")
    elif not (0.0 <= ingredients.probability_favorable <= 1.0):
        missing.append("probability_favorable_out_of_range")
    if ingredients.gross_outcome_if_favorable is None:
        missing.append("gross_outcome_if_favorable")
    if ingredients.gross_outcome_if_unfavorable is None:
        missing.append("gross_outcome_if_unfavorable")
    if ingredients.total_cost is None:
        missing.append("total_cost")

    if len(missing) == 4:
        return AfterCostEvResult(
            identifiability="NOT_IDENTIFIABLE", after_cost_ev=None, missing_components=missing,
            probability_source=ingredients.probability_source,
        )
    if len(missing) > 0:
        return AfterCostEvResult(
            identifiability="PARTIAL", after_cost_ev=None, missing_components=missing,
            probability_source=ingredients.probability_source,
        )

    gross_ev = (
        ingredients.probability_favorable * ingredients.gross_outcome_if_favorable
        + (1.0 - ingredients.probability_favorable) * ingredients.gross_outcome_if_unfavorable
    )
    after_cost_ev = gross_ev - ingredients.total_cost
    return AfterCostEvResult(
        identifiability="IDENTIFIABLE", after_cost_ev=after_cost_ev, missing_components=[],
        probability_source=ingredients.probability_source,
    )
