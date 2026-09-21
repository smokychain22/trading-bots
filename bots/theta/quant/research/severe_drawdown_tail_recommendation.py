"""TAIL_RESEARCH_RECOMMENDATION comparator (directive Item B, section 8).

Compares (A) one common drawdown definition + conditional model, (B) a
volatility-normalized definition + conditional model, and (C) the
continuous conditional tail distribution (cohort-quantile baseline),
purely on OUT-OF-SAMPLE calibration and stability -- never on in-sample
fit. This module has no Production authority; it only formalizes the
decision rule so that whenever real OOS evidence exists for all three
approaches, the comparison is made the same honest way every time rather
than picked ad hoc per session.

No cherry-picking: if no approach clears the minimum OOS sample size or
lacks calibration evidence entirely, the function returns
INSUFFICIENT_EMPIRICAL_EVIDENCE rather than forcing a recommendation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

TailApproach = str  # 'COMMON_DRAWDOWN_CONDITIONAL_MODEL' | 'VOLATILITY_NORMALIZED_CONDITIONAL_MODEL' | 'CONTINUOUS_CONDITIONAL_TAIL_DISTRIBUTION'

# Conservative floor for "can this approach even be compared" -- not itself
# a claim about statistical power for any specific downstream decision.
MIN_OOS_N_FOR_RECOMMENDATION = 200


@dataclass(frozen=True)
class ApproachEvidence:
    approach: TailApproach
    oos_n: int
    # Lower is better (e.g. Expected Calibration Error for the binary
    # models, or mean |empirical_coverage - nominal_quantile| for the
    # continuous cohort-quantile baseline). None means calibration was
    # never actually measured -- never treated as zero/perfect.
    oos_calibration_error: Optional[float]
    # Lower is better; None means stability was never measured.
    oos_stability_score: Optional[float]


@dataclass(frozen=True)
class TailRecommendationResult:
    recommendation: str  # one of the three TailApproach values, or 'INSUFFICIENT_EMPIRICAL_EVIDENCE'
    reason: str
    evaluated_approaches: Tuple[TailApproach, ...]


def recommend_tail_approach(evidence: Sequence[ApproachEvidence]) -> TailRecommendationResult:
    if not evidence:
        return TailRecommendationResult(
            recommendation="INSUFFICIENT_EMPIRICAL_EVIDENCE",
            reason="NO_APPROACH_EVIDENCE_SUPPLIED", evaluated_approaches=(),
        )
    eligible = [
        item for item in evidence
        if item.oos_n >= MIN_OOS_N_FOR_RECOMMENDATION and item.oos_calibration_error is not None
    ]
    if not eligible:
        return TailRecommendationResult(
            recommendation="INSUFFICIENT_EMPIRICAL_EVIDENCE",
            reason="NO_APPROACH_MET_MINIMUM_OOS_N_WITH_MEASURED_CALIBRATION",
            evaluated_approaches=tuple(item.approach for item in evidence),
        )
    best = min(
        eligible,
        key=lambda item: (
            item.oos_calibration_error,
            item.oos_stability_score if item.oos_stability_score is not None else float("inf"),
        ),
    )
    return TailRecommendationResult(
        recommendation=best.approach,
        reason="LOWEST_OOS_CALIBRATION_ERROR_AMONG_APPROACHES_MEETING_MINIMUM_OOS_N",
        evaluated_approaches=tuple(item.approach for item in eligible),
    )
