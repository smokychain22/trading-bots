"""R8 Paper-validation analytics contracts.

Prepared NOW so Paper evidence can be analyzed the moment it exists --
this module does not activate Paper, submit anything, or assume Paper has
run. Its input source must be `PAPER_EXECUTION` evidence: a function here
REFUSES a shadow or historical-replay source rather than silently pooling
evidence classes of different quality.

Operational reliability is a first-class output, not an afterthought: a
strategy with positive P&L and repeated duplicate submissions or
reconciliation drift is NOT healthy, and `assess_strategy_stability`
treats it that way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

from research.dataset_readiness import EvidenceSourceLabel


class EvidenceSourceMismatch(Exception):
    """Raised when Paper analytics are handed non-Paper evidence."""


class StabilityRecommendation(str, Enum):
    """Research RECOMMENDATION only -- never a runtime action. Codex owns
    every Production status change."""

    NORMAL = "NORMAL"
    WATCH = "WATCH"
    DEGRADED = "DEGRADED"
    HOLD_ONLY = "HOLD_ONLY"
    RETIRE_RECOMMENDED = "RETIRE_RECOMMENDED"


@dataclass(frozen=True)
class PaperEpisodeSummary:
    """The canonical Paper validation summary. Every economic field is
    Optional -- an unresolved or unmeasured quantity stays None, never 0.
    Win rate is present but can never stand alone (TRD OUT-001..004): the
    payoff, tail, drawdown and open-MTM fields travel with it."""

    evidence_source: EvidenceSourceLabel
    sample_size: int
    effective_n: int
    managed_episodes: int
    whole_chains: int
    open_mark_to_market: Optional[float]
    realized_pnl: Optional[float]
    whole_chain_pnl: Optional[float]
    return_on_secured_capital: Optional[float]
    return_per_capital_day: Optional[float]
    profit_factor: Optional[float]
    avg_win: Optional[float]
    avg_loss: Optional[float]
    win_rate: Optional[float]
    expected_shortfall: Optional[float]
    max_drawdown: Optional[float]
    capital_utilization: Optional[float]
    assignment_frequency: Optional[float]
    recovery_duration_days: Optional[float]
    call_away_frequency: Optional[float]
    execution_slippage: Optional[float]
    missed_fills: int
    rejected_orders: int
    duplicate_order_count: int
    reconciliation_incidents: int
    brier_score: Optional[float]
    expected_calibration_error: Optional[float]
    by_strategy_version: Dict[str, int] = field(default_factory=dict)
    by_regime: Dict[str, int] = field(default_factory=dict)


def require_paper_evidence(source: EvidenceSourceLabel) -> None:
    """Guard every Paper analytic. Shadow observations and historical
    replay are different evidence classes and may never be analyzed as
    Paper execution."""
    if source != EvidenceSourceLabel.PAPER_EXECUTION:
        raise EvidenceSourceMismatch(
            f"PAPER_ANALYTICS_REQUIRE_PAPER_EXECUTION_EVIDENCE: got {source.value} -- "
            "shadow and historical evidence must never be pooled with Paper fills"
        )


@dataclass(frozen=True)
class OperationalIncidentTally:
    """R8 section 42: operational failures matter even when strategy P&L
    is positive."""

    duplicate_submissions: int
    ambiguous_fills: int
    reconciliation_drift: int
    worker_restarts: int
    provider_outages: int
    stale_quotes: int
    partial_fills: int
    cancel_fill_races: int
    assignment_mismatches: int
    covered_call_mismatches: int
    external_activity_events: int

    def total(self) -> int:
        return sum(getattr(self, name) for name in self.__dataclass_fields__)

    def blocking_incidents(self) -> int:
        """Incidents that indicate a correctness/lifecycle defect rather
        than ordinary market friction. A partial fill or a stale quote is
        expected market reality; a duplicate submission, an ambiguous
        fill, reconciliation drift, or an assignment/CC mismatch is a
        defect."""
        return (
            self.duplicate_submissions + self.ambiguous_fills + self.reconciliation_drift
            + self.assignment_mismatches + self.covered_call_mismatches
        )


@dataclass(frozen=True)
class DriftObservation:
    """Tri-state drift signals. `None` means not measured -- never
    interpreted as "no drift"."""

    ev_deteriorating: Optional[bool]
    calibration_deteriorating: Optional[bool]
    tail_deteriorating: Optional[bool]
    slippage_deteriorating: Optional[bool]
    regime_breakdown: Optional[bool]
    feature_drift: Optional[bool]


@dataclass(frozen=True)
class StabilityAssessment:
    recommendation: StabilityRecommendation
    reasons: List[str]


def assess_strategy_stability(
    summary: PaperEpisodeSummary,
    drift: DriftObservation,
    incidents: OperationalIncidentTally,
    sample_confidence_acceptable: Optional[bool],
) -> StabilityAssessment:
    """Produces a RECOMMENDATION only. Precedence, strictest first:

    1. A blocking operational defect -> HOLD_ONLY regardless of P&L.
    2. Tail or EV deterioration -> DEGRADED (or RETIRE_RECOMMENDED when
       both, plus calibration, deteriorate together).
    3. Any other measured deterioration, or unconfirmed sample
       confidence -> WATCH.
    4. Otherwise NORMAL.

    Unmeasured (`None`) drift never counts as healthy -- it produces at
    least WATCH, because "we did not look" is not evidence of stability.
    """
    require_paper_evidence(summary.evidence_source)
    reasons: List[str] = []

    if incidents.blocking_incidents() > 0:
        reasons.append(
            f"BLOCKING_OPERATIONAL_INCIDENTS:{incidents.blocking_incidents()} -- "
            "correctness/lifecycle defects outrank positive P&L"
        )
        return StabilityAssessment(StabilityRecommendation.HOLD_ONLY, reasons)

    deteriorating = [
        name for name in ("ev_deteriorating", "calibration_deteriorating", "tail_deteriorating",
                           "slippage_deteriorating", "regime_breakdown", "feature_drift")
        if getattr(drift, name) is True
    ]
    unmeasured = [
        name for name in ("ev_deteriorating", "calibration_deteriorating", "tail_deteriorating",
                           "slippage_deteriorating", "regime_breakdown", "feature_drift")
        if getattr(drift, name) is None
    ]

    if drift.ev_deteriorating is True and drift.tail_deteriorating is True and drift.calibration_deteriorating is True:
        reasons.append("EV_TAIL_AND_CALIBRATION_ALL_DETERIORATING")
        return StabilityAssessment(StabilityRecommendation.RETIRE_RECOMMENDED, reasons)

    if drift.ev_deteriorating is True or drift.tail_deteriorating is True:
        reasons.append(f"CORE_ECONOMIC_DETERIORATION:{','.join(sorted(deteriorating))}")
        return StabilityAssessment(StabilityRecommendation.DEGRADED, reasons)

    if deteriorating:
        reasons.append(f"SECONDARY_DETERIORATION:{','.join(sorted(deteriorating))}")
        return StabilityAssessment(StabilityRecommendation.WATCH, reasons)

    if unmeasured:
        reasons.append(f"UNMEASURED_DRIFT_DIMENSIONS:{','.join(sorted(unmeasured))} -- not looking is not evidence of stability")
        return StabilityAssessment(StabilityRecommendation.WATCH, reasons)

    if sample_confidence_acceptable is not True:
        reasons.append("SAMPLE_CONFIDENCE_NOT_CONFIRMED")
        return StabilityAssessment(StabilityRecommendation.WATCH, reasons)

    reasons.append("NO_MEASURED_DETERIORATION_AND_SAMPLE_CONFIDENCE_CONFIRMED")
    return StabilityAssessment(StabilityRecommendation.NORMAL, reasons)


def empty_paper_summary() -> PaperEpisodeSummary:
    """The honest current state: Paper has never run, so every economic
    field is None and every count is zero."""
    return PaperEpisodeSummary(
        evidence_source=EvidenceSourceLabel.PAPER_EXECUTION, sample_size=0, effective_n=0,
        managed_episodes=0, whole_chains=0, open_mark_to_market=None, realized_pnl=None,
        whole_chain_pnl=None, return_on_secured_capital=None, return_per_capital_day=None,
        profit_factor=None, avg_win=None, avg_loss=None, win_rate=None, expected_shortfall=None,
        max_drawdown=None, capital_utilization=None, assignment_frequency=None,
        recovery_duration_days=None, call_away_frequency=None, execution_slippage=None,
        missed_fills=0, rejected_orders=0, duplicate_order_count=0, reconciliation_incidents=0,
        brier_score=None, expected_calibration_error=None,
    )
