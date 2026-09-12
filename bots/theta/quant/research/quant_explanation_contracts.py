"""R5 fast-forward: canonical owner-facing quantitative explanation
contract (research-side shape only -- Codex owns any Production UI/API
that renders these).

Ties together this branch's existing pieces (`management_policy.py`'s
`ManagementDecisionExplanation`, `action_value_distribution.py`'s
`OutcomeDistribution`, `champion_challenger.py`'s `BranchStatus`) into the
one canonical set of explanation fields the R5 directive names, so a
future Production explanation surface has an exact target shape to build
against. No field here may ever report a bare, uncalibrated confidence
percentage -- `probability_positive` (etc.) is only ever populated from a
genuinely calibrated model (per `calibration_metrics.py`), otherwise it
stays `None`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from research.action_value_distribution import OutcomeDistribution
from research.champion_challenger import BranchStatus
from research.dataset_contracts import ThetaStrategyAction


@dataclass(frozen=True)
class CandidateExplanation:
    """WHY_OPEN / WHY_NOT_OPEN / WHY_THIS_CONTRACT / WHY_NOT_SECOND_BEST."""

    candidate_id: str
    why_open: Optional[str]  # None when this candidate was NOT selected
    why_not_open: Optional[str]  # None when this candidate WAS selected
    why_this_contract: str  # the trade-off statement among premium/break-even/assignment/skew/expected-move/tail/execution (spec section 18)
    why_not_second_best: Optional[str]  # None if there was no second-best candidate
    soft_positive_evidence: Tuple[str, ...] = field(default_factory=tuple)
    soft_negative_evidence: Tuple[str, ...] = field(default_factory=tuple)
    unknown_fields: Tuple[str, ...] = field(default_factory=tuple)  # what remains genuinely UNKNOWN for this candidate, never silently omitted
    invalidation_conditions: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class PositionExplanation:
    """WHY_HOLD / WHY_CLOSE / WHY_ROLL / WHY_ASSIGN / WHY_WAIT_FOR_RECOVERY
    / WHY_SELL_CC -- the chosen action plus every rejected alternative's
    own outcome distribution, never only the winner."""

    position_label: str
    chosen_action: ThetaStrategyAction
    chosen_action_reason: str
    alternatives_considered: Tuple[OutcomeDistribution, ...]
    invalidation_conditions: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class StrategyExplanation:
    """CHAMPION / CHALLENGER / RESEARCH_ONLY / DEGRADED / HOLD_ONLY /
    RETIRED -- reused directly from `champion_challenger.py`'s
    `BranchStatus`, never a duplicate status vocabulary."""

    branch: str
    status: BranchStatus
    status_reason: str


@dataclass(frozen=True)
class PerformanceExplanation:
    """The canonical performance field set (spec section 40/R5 directive) --
    every field Optional/None until real data exists; never headline WR
    alone."""

    whole_chain_net_pnl: Optional[float]
    managed_episode_net_pnl: Optional[float]
    return_on_secured_capital: Optional[float]
    return_per_capital_day: Optional[float]
    expected_shortfall: Optional[float]
    max_drawdown_pct: Optional[float]
    assignment_burden: Optional[float]  # e.g. fraction of committed capital currently held as assigned stock
    recovery_duration_days: Optional[float]
    execution_degradation: Optional[float]  # realized slippage/spread-capture shortfall vs. the structural (non-calibrated) execution model


"""Every management action a position explanation must be able to justify
(R5 section 35). Kept as a frozen tuple over the CANONICAL action
vocabulary -- never a new parallel action enum."""
REQUIRED_POSITION_EXPLANATION_ACTIONS: Tuple[ThetaStrategyAction, ...] = (
    ThetaStrategyAction.HOLD,
    ThetaStrategyAction.CLOSE_FULL,
    ThetaStrategyAction.ROLL,
    ThetaStrategyAction.ACCEPT_ASSIGNMENT,
    ThetaStrategyAction.LET_EXPIRE,
    ThetaStrategyAction.RECOVERY_WAIT,
    ThetaStrategyAction.SELL_STOCK,
    ThetaStrategyAction.SELL_CC,
    ThetaStrategyAction.HOLD_CC,
    ThetaStrategyAction.CLOSE_CC,
    ThetaStrategyAction.ROLL_CC,
    ThetaStrategyAction.ALLOW_CALL_AWAY,
)


def missing_position_explanation_actions(covered: Tuple[ThetaStrategyAction, ...]) -> List[ThetaStrategyAction]:
    """Which of the twelve required actions a given explanation surface
    cannot yet justify. Empty list = full coverage."""
    return [action for action in REQUIRED_POSITION_EXPLANATION_ACTIONS if action not in covered]


@dataclass(frozen=True)
class ExplanationConsistencyReport:
    consistent: bool
    invented_fields: List[str]
    reasons: List[str]


def validate_explanation_consistency(
    explanation_fields: Dict[str, object],
    decision_fields: Dict[str, object],
) -> ExplanationConsistencyReport:
    """R5 section 36: the human-readable explanation must derive from the
    SAME machine-readable fields that produced the decision. Any key
    present in the explanation but absent from the decision state is an
    INVENTED field -- a reason, probability, EV, blocker or threshold that
    the decision never actually used -- and is reported as a consistency
    violation. A value that disagrees with the decision's own value for a
    shared key is likewise a violation."""
    invented = [key for key in explanation_fields if key not in decision_fields]
    mismatched = [
        key for key in explanation_fields
        if key in decision_fields and explanation_fields[key] != decision_fields[key]
    ]

    reasons: List[str] = []
    if invented:
        reasons.append(f"EXPLANATION_INVENTED_FIELDS:{','.join(sorted(invented))}")
    if mismatched:
        reasons.append(f"EXPLANATION_CONTRADICTS_DECISION_FIELDS:{','.join(sorted(mismatched))}")
    if not reasons:
        reasons.append("EXPLANATION_DERIVES_ENTIRELY_FROM_DECISION_FIELDS")

    return ExplanationConsistencyReport(
        consistent=(not invented and not mismatched),
        invented_fields=sorted(invented + mismatched),
        reasons=reasons,
    )


@dataclass(frozen=True)
class R5ExitCheck:
    candidate_explanation_complete: bool
    position_explanation_covers_every_action: bool
    strategy_explanation_reuses_branch_status: bool
    performance_explanation_complete: bool
    uncalibrated_probability_guard_active: bool
    explanation_consistency_validated: bool


def r5_quant_explanation_contract(check: R5ExitCheck) -> str:
    """"PASS" only when every criterion holds."""
    return "PASS" if all(getattr(check, name) for name in check.__dataclass_fields__) else "FAIL"


def validate_no_uncalibrated_confidence(distribution: OutcomeDistribution, calibration_confirmed: bool) -> Optional[str]:
    """The one guardrail this whole contract exists to enforce: a
    `probability_positive` value may be reported to an owner-facing
    explanation ONLY when `calibration_confirmed` is True (i.e. a real
    `calibration_metrics.py` result backs it). Returns a violation message
    if a probability is present without calibration confirmation, else
    None."""
    if distribution.probability_positive is not None and not calibration_confirmed:
        return (
            f"UNCALIBRATED_CONFIDENCE_BLOCKED: distribution for action={distribution.action} reports "
            "probability_positive without a confirmed calibration result -- this may never reach an "
            "owner-facing explanation as if it were a real probability"
        )
    return None
