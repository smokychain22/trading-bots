"""Economic opportunity frontier: Pareto-dominance filtering.

Rather than ranking candidates by one scalar (e.g. gross credit or EV_net
alone -- exactly the naive policy `BQ-1`/`BQ-2` in
docs/quant/phase2/BENCHMARK_AND_EXPERIMENT_REGISTRY.md exist to beat), this
module retains every economically relevant dimension per candidate and
eliminates only those that are STRICTLY DOMINATED -- worse-or-equal on
every dimension, strictly worse on at least one. The surviving
(Pareto-efficient) candidates are the input to whatever final ranking (e.g.
by `ReturnPerCapitalDay`, as `opportunity_frontier.py` already does) a
caller applies; this module does not itself pick a winner among survivors.

UNKNOWN dimensions never count toward a dominance claim in either
direction: if either candidate's value for a dimension is `None`, that
dimension is skipped when comparing the pair. An unknown quantity is never
treated as "better," "worse," or "tied" -- it is excluded from the
comparison entirely, consistent with `UNKNOWN != a fabricated default`
everywhere else in this repository.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Sequence


class DominanceDirection(str, Enum):
    MAXIMIZE = "MAXIMIZE"
    MINIMIZE = "MINIMIZE"


@dataclass(frozen=True)
class CandidateEconomics:
    candidate_id: str
    gross_credit: Optional[float]  # reporting only -- NOT a dominance dimension, see module docstring
    ev_net: Optional[float]
    calibrated_p_win: Optional[float]
    break_even_wr: Optional[float]
    edge_buffer: Optional[float]
    expected_tail_loss: Optional[float]  # ES/CVaR magnitude, reported as a positive number
    assignment_probability: Optional[float]
    severe_drawdown_probability: Optional[float]
    capital_requirement: Optional[float]
    capital_days: Optional[float]
    return_per_capital_day: Optional[float]
    liquidity_spread_pct: Optional[float]
    fill_probability: Optional[float]
    expected_slippage: Optional[float]
    model_uncertainty: Optional[float]


# Field -> optimization direction. Only fields with an unambiguous "more is
# better"/"less is better" interpretation participate in dominance;
# calibrated_p_win/break_even_wr are deliberately excluded (a higher
# calibrated win probability is not unambiguously "better" independent of
# the payoff it's attached to -- that tradeoff is exactly what EV_net
# already prices in, so including both would double-count the same
# economic fact).
_DOMINANCE_FIELDS: Dict[str, DominanceDirection] = {
    "ev_net": DominanceDirection.MAXIMIZE,
    "edge_buffer": DominanceDirection.MAXIMIZE,
    "return_per_capital_day": DominanceDirection.MAXIMIZE,
    "fill_probability": DominanceDirection.MAXIMIZE,
    "expected_tail_loss": DominanceDirection.MINIMIZE,
    "assignment_probability": DominanceDirection.MINIMIZE,
    "severe_drawdown_probability": DominanceDirection.MINIMIZE,
    "capital_requirement": DominanceDirection.MINIMIZE,
    "capital_days": DominanceDirection.MINIMIZE,
    "liquidity_spread_pct": DominanceDirection.MINIMIZE,
    "expected_slippage": DominanceDirection.MINIMIZE,
    "model_uncertainty": DominanceDirection.MINIMIZE,
}


def _dominates(a: CandidateEconomics, b: CandidateEconomics) -> bool:
    """True if ``a`` dominates ``b``: at least as good on every dimension
    both candidates have a known value for, and strictly better on at
    least one such dimension. A pair with no comparable (both-known)
    dimension at all can never dominate one another."""
    at_least_as_good_everywhere = True
    strictly_better_somewhere = False
    comparable_dimension_found = False

    for field_name, direction in _DOMINANCE_FIELDS.items():
        a_value = getattr(a, field_name)
        b_value = getattr(b, field_name)
        if a_value is None or b_value is None:
            continue
        comparable_dimension_found = True

        if direction == DominanceDirection.MAXIMIZE:
            if a_value < b_value:
                at_least_as_good_everywhere = False
                break
            if a_value > b_value:
                strictly_better_somewhere = True
        else:
            if a_value > b_value:
                at_least_as_good_everywhere = False
                break
            if a_value < b_value:
                strictly_better_somewhere = True

    return comparable_dimension_found and at_least_as_good_everywhere and strictly_better_somewhere


def compute_pareto_frontier(candidates: Sequence[CandidateEconomics]) -> List[CandidateEconomics]:
    """Returns the non-dominated subset of ``candidates`` -- every candidate
    not strictly dominated by at least one other candidate in the set.
    Input order is preserved; this is a filter, not a ranking (a caller
    ranks the survivors afterward, e.g. by ReturnPerCapitalDay, as
    opportunity_frontier.py already does)."""
    survivors: List[CandidateEconomics] = []
    for candidate in candidates:
        dominated = any(
            other.candidate_id != candidate.candidate_id and _dominates(other, candidate)
            for other in candidates
        )
        if not dominated:
            survivors.append(candidate)
    return survivors


def dominated_by(candidates: Sequence[CandidateEconomics], candidate_id: str) -> List[str]:
    """Diagnostic for the shadow opportunity book: which candidate_ids
    dominate the named one (empty if it is itself non-dominated). Raises if
    ``candidate_id`` is not present in ``candidates`` -- never silently
    returns an empty list for a typo'd id."""
    target = next((c for c in candidates if c.candidate_id == candidate_id), None)
    if target is None:
        raise ValueError(f"No candidate with id {candidate_id}")
    return [
        other.candidate_id for other in candidates
        if other.candidate_id != candidate_id and _dominates(other, target)
    ]
