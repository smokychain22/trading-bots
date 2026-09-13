"""R8 Paper-evidence cohort reporting and P&L decomposition (CONTRACT/SHAPE).

`paper_validation_analytics.py` already covers Paper-only evidence
separation, operational incident tally, and a stability recommendation.
This module adds the two things that were still missing before real Paper
evidence arrives: (1) a fixed cohort-dimension vocabulary so slicing
outcomes never becomes ad hoc column-picking, and (2) a P&L decomposition
contract that separates WHY an episode's realized result differed from
its decision-time prediction -- decision alpha, execution alpha, sizing
effect, management effect, and tail realization -- rather than reporting
one undifferentiated "it won" or "it lost."

Like `action_value_distribution.py`, this is CONTRACT/SHAPE work: every
field is Optional and None until a real, resolved episode supplies it.
There is no synthetic performance number anywhere in this module, and it
is exercised only against hand-built fixtures. `EV_MODEL_NOT_EMPIRICALLY_
READY` is unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple


class CohortDimension(str, Enum):
    """Every axis a Paper-evidence report must be able to slice by. A
    cohort report that only reports one aggregate number across all of
    these is not yet a cohort report."""

    STRATEGY_BRANCH = "STRATEGY_BRANCH"
    UNDERLYING = "UNDERLYING"
    SECTOR = "SECTOR"
    REGIME = "REGIME"
    IV_STATE = "IV_STATE"
    DTE_BUCKET = "DTE_BUCKET"
    DELTA_BUCKET = "DELTA_BUCKET"
    PROFIT_TARGET_POLICY = "PROFIT_TARGET_POLICY"
    MANAGEMENT_POLICY = "MANAGEMENT_POLICY"
    ASSIGNMENT_STATE = "ASSIGNMENT_STATE"
    RECOVERY_STATE = "RECOVERY_STATE"
    EXECUTION_QUALITY_BUCKET = "EXECUTION_QUALITY_BUCKET"
    GEX_BUCKET = "GEX_BUCKET"
    FLOW_BUCKET = "FLOW_BUCKET"
    LIQUIDITY_BUCKET = "LIQUIDITY_BUCKET"


@dataclass(frozen=True)
class CohortKey:
    """One concrete cohort: a dimension plus its observed value for one
    episode, e.g. (STRATEGY_BRANCH, "THETA_CONVENTIONAL")."""

    dimension: CohortDimension
    value: str


@dataclass(frozen=True)
class PnLDecomposition:
    """Splits ONE episode's realized-vs-predicted gap into named, mutually
    exclusive causes. Every field Optional/None until real fill/mark/
    reconciliation evidence exists -- never fabricated, never defaulted to
    zero to make the components "add up."

    decision_alpha: the edge the decision-time model itself predicted
        (predicted_ev at entry), independent of what execution or later
        management did.
    execution_alpha: fill price vs decision-time reference price/limit --
        positive means execution improved on the reference, negative means
        it cost money beyond the decision-time model's assumption.
    sizing_effect: P&L attributable to the realized quantity differing
        from what a reference/baseline sizing policy would have chosen
        (e.g. capacity-capped below an otherwise-eligible quantity).
    management_effect: incremental P&L from post-entry management actions
        (roll/close/assign/recovery/CC) versus a fixed do-nothing-until-
        expiry counterfactual for the SAME entry.
    tail_realization: the portion of realized P&L attributable to a
        genuine outlier/tail draw rather than to any of the above --
        distinguishing "the model was wrong" from "a rare event happened
        to a correctly-specified model."
    """

    decision_alpha: Optional[float]
    execution_alpha: Optional[float]
    sizing_effect: Optional[float]
    management_effect: Optional[float]
    tail_realization: Optional[float]

    def known_components(self) -> List[float]:
        return [
            value for value in (
                self.decision_alpha, self.execution_alpha, self.sizing_effect,
                self.management_effect, self.tail_realization,
            )
            if value is not None
        ]

    def is_fully_known(self) -> bool:
        return len(self.known_components()) == 5


class DecompositionReconciliationError(ValueError):
    """Raised when every component of a decomposition is known but their
    sum does not match the episode's realized whole-chain P&L -- meaning
    a component was double-counted, omitted, or mis-signed somewhere in
    the pipeline that produced them. This must never be silently ignored
    or "balanced" by adjusting one term after the fact."""


def reconcile_decomposition(
    decomposition: PnLDecomposition, realized_whole_chain_pnl: Optional[float], tolerance: float = 0.01,
) -> Optional[bool]:
    """Returns True if every component is known AND sums to the realized
    P&L within `tolerance`; False if every component is known and they do
    NOT sum (a genuine defect -- callers should raise, not just record
    False, unless they are deliberately surveying many episodes for
    defects). Returns None -- never True/False by assumption -- when the
    decomposition or the realized P&L is not yet fully known."""
    if not decomposition.is_fully_known() or realized_whole_chain_pnl is None:
        return None
    total = sum(decomposition.known_components())
    return abs(total - realized_whole_chain_pnl) <= tolerance


def require_reconciled_decomposition(
    decomposition: PnLDecomposition, realized_whole_chain_pnl: Optional[float], tolerance: float = 0.01,
) -> None:
    """Raises `DecompositionReconciliationError` the moment a fully-known
    decomposition fails to reconcile. Callers that need a defensible
    per-episode decomposition (rather than a survey of many episodes for
    audit purposes) should call this rather than silently trusting
    `reconcile_decomposition`'s boolean."""
    result = reconcile_decomposition(decomposition, realized_whole_chain_pnl, tolerance)
    if result is False:
        total = sum(decomposition.known_components())
        raise DecompositionReconciliationError(
            f"decomposition components sum to {total}, but realized whole-chain P&L is "
            f"{realized_whole_chain_pnl} -- a component is double-counted, omitted, or mis-signed"
        )


@dataclass(frozen=True)
class PredictedVsRealized:
    """One episode's decision-time prediction paired with its eventual
    resolved outcome -- the raw material for calibration and for
    `PnLDecomposition.decision_alpha`. `error` is None whenever either side
    is unknown, never computed against a placeholder."""

    predicted_ev: Optional[float]
    realized_pnl: Optional[float]

    @property
    def error(self) -> Optional[float]:
        if self.predicted_ev is None or self.realized_pnl is None:
            return None
        return self.realized_pnl - self.predicted_ev


@dataclass(frozen=True)
class CohortEpisode:
    """One resolved episode's cohort memberships plus its
    prediction/realization pair and decomposition -- the unit a
    `CohortReport` aggregates over."""

    episode_id: str
    keys: Tuple[CohortKey, ...]
    prediction: PredictedVsRealized
    decomposition: PnLDecomposition


@dataclass(frozen=True)
class CohortAggregate:
    """Aggregated statistics for one cohort value. Every numeric field is
    Optional and computed only from episodes where the underlying value is
    known -- an episode with an unresolved prediction contributes to `n`
    but not to `mean_error`, and this must never be presented as if the
    full cohort had zero error."""

    key: CohortKey
    n: int
    n_with_known_error: int
    mean_predicted_ev: Optional[float]
    mean_realized_pnl: Optional[float]
    mean_error: Optional[float]


def _mean(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def build_cohort_report(episodes: List[CohortEpisode]) -> Dict[CohortKey, CohortAggregate]:
    """Groups episodes by every `CohortKey` they carry (one episode
    contributes to every dimension/value pair it has, e.g. both its
    STRATEGY_BRANCH cohort and its DTE_BUCKET cohort) and reports simple
    means -- no model fitting happens here. This is descriptive-stage
    machinery, valid the moment `DESCRIPTIVE_AUDIT_ONLY` readiness is
    reached; it does not require `MODEL_FIT_ELIGIBLE`."""
    grouped: Dict[CohortKey, List[CohortEpisode]] = {}
    for episode in episodes:
        for key in episode.keys:
            grouped.setdefault(key, []).append(episode)

    report: Dict[CohortKey, CohortAggregate] = {}
    for key, members in grouped.items():
        predicted = [m.prediction.predicted_ev for m in members if m.prediction.predicted_ev is not None]
        realized = [m.prediction.realized_pnl for m in members if m.prediction.realized_pnl is not None]
        errors = [m.prediction.error for m in members if m.prediction.error is not None]
        report[key] = CohortAggregate(
            key=key, n=len(members), n_with_known_error=len(errors),
            mean_predicted_ev=_mean(predicted), mean_realized_pnl=_mean(realized),
            mean_error=_mean(errors),
        )
    return report
