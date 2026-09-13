"""Loss / mistake attribution taxonomy (adversarial-review directive item).

Loss management is a first-class research program, not an afterthought to
entry research. This module gives failure attribution a fixed vocabulary
and -- critically -- REFUSES to attribute a loss to any category without
at least one piece of supporting evidence. "The trade lost money" is never
by itself proof of "the decision was a mistake": a well-specified, positive
after-cost-EV decision can still lose on a single realization (normal
statistical variance), and a bad decision can still win (a lucky outcome).
Conflating the two is exactly the failure mode this module exists to
prevent -- it never labels every loss a mistake, and never lets a win hide
a bad process.

This module computes and classifies; it recommends nothing about
Production, activates nothing, and requires no market/broker connection --
provider-independent, and legitimate work while DATASET_ABSENT.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple


class FailureCategory(str, Enum):
    """Every category is a candidate explanation, never a default. A loss
    with no supporting evidence for any of these stays UNATTRIBUTED_
    NORMAL_VARIANCE -- the honest "nothing here proves a process error"
    outcome, not silence."""

    BAD_UNDERLYING_SELECTION = "BAD_UNDERLYING_SELECTION"
    DIRECTIONAL_REGIME_ERROR = "DIRECTIONAL_REGIME_ERROR"
    VOLATILITY_EXPANSION = "VOLATILITY_EXPANSION"
    GAP_EVENT_SHOCK = "GAP_EVENT_SHOCK"
    LIQUIDITY_FAILURE = "LIQUIDITY_FAILURE"
    BAD_CONTRACT_SELECTION = "BAD_CONTRACT_SELECTION"
    OVER_SIZING = "OVER_SIZING"
    CORRELATION_CONCENTRATION = "CORRELATION_CONCENTRATION"
    EXECUTION_SLIPPAGE = "EXECUTION_SLIPPAGE"
    BAD_MANAGEMENT_TIMING = "BAD_MANAGEMENT_TIMING"
    BAD_ROLL = "BAD_ROLL"
    ASSIGNMENT_OUTCOME = "ASSIGNMENT_OUTCOME"
    BAD_RECOVERY_POLICY = "BAD_RECOVERY_POLICY"
    BAD_CC_POLICY = "BAD_CC_POLICY"
    BAD_FLOW_INTERPRETATION = "BAD_FLOW_INTERPRETATION"
    OVER_STRICT_GATE = "OVER_STRICT_GATE"  # a real opportunity was refused that should have passed
    UNDER_STRICT_GATE = "UNDER_STRICT_GATE"  # a candidate that should have been refused was allowed through
    PROVIDER_FAILURE = "PROVIDER_FAILURE"
    STALE_DATA = "STALE_DATA"
    LIFECYCLE_BROKER_MISMATCH = "LIFECYCLE_BROKER_MISMATCH"
    MODEL_CALIBRATION_FAILURE = "MODEL_CALIBRATION_FAILURE"
    UNATTRIBUTED_NORMAL_VARIANCE = "UNATTRIBUTED_NORMAL_VARIANCE"


class DecisionQuality(str, Enum):
    """Process and outcome are independent axes. A single realized P&L
    number can never by itself distinguish these four cells -- distinguishing
    them requires the pre-decision information set and the ex-ante expected
    value, not the ex-post result."""

    GOOD_PROCESS_GOOD_OUTCOME = "GOOD_PROCESS_GOOD_OUTCOME"
    GOOD_PROCESS_BAD_OUTCOME = "GOOD_PROCESS_BAD_OUTCOME"  # normal variance -- not a mistake
    BAD_PROCESS_LUCKY_OUTCOME = "BAD_PROCESS_LUCKY_OUTCOME"  # do not let the win hide the defect
    BAD_PROCESS_BAD_OUTCOME = "BAD_PROCESS_BAD_OUTCOME"


@dataclass(frozen=True)
class FailureAttribution:
    """A single attributed cause. `evidence` must be a non-empty list of
    concrete, checkable observations (e.g. "expected_shortfall exceeded
    the pre-trade estimate by 3.2x" or "quote_age_ms=48000 > policy limit
    5000ms at decision time") -- never a bare category label with no
    supporting fact."""

    category: FailureCategory
    evidence: Tuple[str, ...]
    confidence: Optional[str]  # e.g. "HIGH"/"MEDIUM"/"LOW", or None if not assessed -- never fabricated
    requires_policy_change: bool


class AttributionWithoutEvidenceError(ValueError):
    """Raised when a caller attempts to attribute a loss to a specific
    process failure without supplying at least one piece of evidence."""


def attribute_failure(
    category: FailureCategory,
    evidence: List[str],
    confidence: Optional[str] = None,
    requires_policy_change: bool = False,
) -> FailureAttribution:
    """The ONLY constructor for a non-UNATTRIBUTED FailureAttribution.
    Raises rather than silently accepting an empty evidence list -- this
    is the structural enforcement of "require failure attribution before
    recommending policy changes," not a convention someone can forget."""
    if category != FailureCategory.UNATTRIBUTED_NORMAL_VARIANCE and not evidence:
        raise AttributionWithoutEvidenceError(
            f"cannot attribute {category.value} without at least one piece of evidence -- "
            "use FailureCategory.UNATTRIBUTED_NORMAL_VARIANCE if no process defect is demonstrated"
        )
    return FailureAttribution(
        category=category, evidence=tuple(evidence),
        confidence=confidence, requires_policy_change=requires_policy_change,
    )


def unattributed(reason: str = "no process defect demonstrated by available evidence") -> FailureAttribution:
    """The honest default for a loss that realized-P&L alone cannot explain
    away as a mistake. Never omit this and never substitute a guessed
    category -- a well-specified decision losing once is not evidence of
    a defect."""
    return FailureAttribution(
        category=FailureCategory.UNATTRIBUTED_NORMAL_VARIANCE,
        evidence=(reason,), confidence=None, requires_policy_change=False,
    )


def classify_decision_quality(
    process_was_defensible: Optional[bool],
    outcome_was_positive: Optional[bool],
) -> Optional[DecisionQuality]:
    """Classifies into the four-cell process/outcome grid. Returns None
    (never a guess) when either input is unknown -- an unresolved episode
    or an un-reviewed decision cannot be classified yet."""
    if process_was_defensible is None or outcome_was_positive is None:
        return None
    if process_was_defensible and outcome_was_positive:
        return DecisionQuality.GOOD_PROCESS_GOOD_OUTCOME
    if process_was_defensible and not outcome_was_positive:
        return DecisionQuality.GOOD_PROCESS_BAD_OUTCOME
    if not process_was_defensible and outcome_was_positive:
        return DecisionQuality.BAD_PROCESS_LUCKY_OUTCOME
    return DecisionQuality.BAD_PROCESS_BAD_OUTCOME


def loss_requires_no_policy_change(quality: DecisionQuality) -> bool:
    """A GOOD_PROCESS_BAD_OUTCOME loss is normal statistical variance --
    the process should NOT be changed in response to it alone. Only
    BAD_PROCESS_* cells (regardless of realized outcome) are candidates
    for a policy change, and even then only with an evidenced
    FailureAttribution, never from this classification alone."""
    return quality == DecisionQuality.GOOD_PROCESS_BAD_OUTCOME
