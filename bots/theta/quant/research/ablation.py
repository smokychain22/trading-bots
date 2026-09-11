"""Feature-family ablation engine for THETA's Full-H economics (R6B).

Answers exactly one question per record: does adding this feature family
to the baseline model IMPROVE, leave NEUTRAL, DEGRADE, or produce an
INCONCLUSIVE change in genuine out-of-sample economics? A feature that is
theoretically sensible (GEX, options flow, a trader-DNA rule) can still
add zero incremental predictive value -- this module is the machinery
that would catch that, not an assumption that every plausible feature
helps.

No feature family may be promoted to executable policy without passing
through this comparison against real forward/OOS data -- consistent with
`docs/research/THETA_MODEL_PROMOTION_CONTRACT.md`. Nothing in this module
has been run against real data; it is exercised only against synthetic
fixtures until real resolved episodes exist
(`docs/research/THETA_EV_MODEL_SPEC.md`'s EV_MODEL_NOT_EMPIRICALLY_READY
status, unchanged).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple


class FeatureFamily(str, Enum):
    OWNERSHIP = "OWNERSHIP"
    EVENT = "EVENT"
    MACRO = "MACRO"
    IV = "IV"
    IV_RV = "IV_RV"
    SKEW = "SKEW"
    TERM_STRUCTURE = "TERM_STRUCTURE"
    GEX = "GEX"
    FLOW = "FLOW"
    TECHNICAL = "TECHNICAL"
    TRADER_DNA = "TRADER_DNA"
    EXECUTION = "EXECUTION"


class FeatureFamilyStatus(str, Enum):
    AVAILABLE = "AVAILABLE"  # a real, tested THETA implementation already produces this feature
    UNKNOWN = "UNKNOWN"  # a real source may exist but its point-in-time availability/quality is not yet confirmed
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"  # no THETA code computes this feature at all yet
    NOT_TESTED = "NOT_TESTED"  # implemented but never run through this ablation engine


# Current, honest status per family -- checked against the actual
# codebase, not asserted from memory. Updated only when the underlying
# implementation status genuinely changes.
CURRENT_FEATURE_FAMILY_STATUS: Dict[FeatureFamily, FeatureFamilyStatus] = {
    FeatureFamily.OWNERSHIP: FeatureFamilyStatus.AVAILABLE,  # ownership_v0.py, real and tested
    FeatureFamily.EVENT: FeatureFamilyStatus.AVAILABLE,  # event-state.ts, real corporate-actions wiring (earnings distance itself remains UNKNOWN, per event-state.ts's own honest gap)
    FeatureFamily.MACRO: FeatureFamilyStatus.NOT_IMPLEMENTED,  # FRED_API_KEY is Codex-configured in production, but no Claude-owned quant feature contract consumes it yet
    FeatureFamily.IV: FeatureFamilyStatus.AVAILABLE,  # Optionomics-sourced, real
    FeatureFamily.IV_RV: FeatureFamilyStatus.NOT_TESTED,  # computable from existing RV + Optionomics IV, never run through an ablation
    FeatureFamily.SKEW: FeatureFamilyStatus.NOT_IMPLEMENTED,
    FeatureFamily.TERM_STRUCTURE: FeatureFamilyStatus.NOT_TESTED,  # only the narrow Cboe VIX/VIX9D ratio exists, research-only
    FeatureFamily.GEX: FeatureFamilyStatus.NOT_IMPLEMENTED,  # formula cataloged (THETA_FORMULA_CATALOG.md), zero THETA code
    FeatureFamily.FLOW: FeatureFamilyStatus.NOT_IMPLEMENTED,
    FeatureFamily.TECHNICAL: FeatureFamilyStatus.AVAILABLE,  # underlying-features.ts, real and tested
    FeatureFamily.TRADER_DNA: FeatureFamilyStatus.NOT_TESTED,  # hypotheses.json exists, never run through this ablation engine
    FeatureFamily.EXECUTION: FeatureFamilyStatus.AVAILABLE,  # execution_quality.py, real and tested
}


class AblationResult(str, Enum):
    IMPROVES = "IMPROVES"
    NEUTRAL = "NEUTRAL"
    DEGRADES = "DEGRADES"
    INCONCLUSIVE = "INCONCLUSIVE"


@dataclass(frozen=True)
class MetricDelta:
    """One metric's baseline value, treatment (baseline+feature) value,
    and their difference -- kept as three explicit numbers rather than
    only the delta, so a reviewer can see the two absolute levels being
    compared, not just the gap between them."""

    baseline_value: Optional[float]
    treatment_value: Optional[float]
    delta: Optional[float]  # treatment - baseline; None if either side is unknown


def _metric_delta(baseline: Optional[float], treatment: Optional[float]) -> MetricDelta:
    delta = (treatment - baseline) if (baseline is not None and treatment is not None) else None
    return MetricDelta(baseline_value=baseline, treatment_value=treatment, delta=delta)


@dataclass(frozen=True)
class AblationRecord:
    experiment_id: str
    baseline_model: str
    feature_family_added: FeatureFamily
    feature_family_status: FeatureFamilyStatus
    feature_set: Tuple[str, ...]  # the exact feature names added, not just the family label
    train_period: Tuple[str, str]
    validation_period: Tuple[str, str]
    forward_period: Tuple[str, str]
    final_oos_touched: bool  # whether this specific ablation run used the reserved final-OOS segment
    raw_n: int
    independent_chain_n: int
    ev_delta: MetricDelta
    return_per_capital_day_delta: MetricDelta
    calibration_delta: MetricDelta  # e.g. ECE delta; more negative = better calibration
    es_delta: MetricDelta  # Expected Shortfall delta; more negative = less tail risk
    drawdown_delta: MetricDelta
    assignment_delta: MetricDelta
    stability_delta: MetricDelta  # e.g. variance of the effect across walk-forward folds
    statistical_uncertainty: Optional[float]  # standard error of ev_delta, or None if not computable
    result: AblationResult
    reasons: List[str] = field(default_factory=list)


def classify_ablation_result(
    ev_delta: Optional[float],
    standard_error: Optional[float],
    meaningful_effect_size: float,
    min_independent_n: int,
    independent_chain_n: int,
) -> Tuple[AblationResult, List[str]]:
    """Classifies IMPROVES / NEUTRAL / DEGRADES / INCONCLUSIVE from an
    EV delta and its standard error, using a 95% confidence interval.

    `meaningful_effect_size` is a REQUIRED, caller-supplied threshold
    (never a hardcoded default) below which even a statistically
    significant delta is treated as NEUTRAL rather than IMPROVES/
    DEGRADES -- a real but economically trivial effect should not be
    reported as if it were decision-relevant. This mirrors the standing
    "do not hardcode arbitrary financial thresholds without a previously
    justified specification" instruction: the caller must supply and
    justify this number, this function does not invent one.

    `min_independent_n`: below this many independent chains, the result
    is always INCONCLUSIVE regardless of what the point estimate shows --
    an ablation on a tiny sample cannot be trusted either way.
    """
    reasons: List[str] = []

    if independent_chain_n < min_independent_n:
        reasons.append(f"independent_chain_n={independent_chain_n} below the required minimum {min_independent_n} -- insufficient evidence either way")
        return AblationResult.INCONCLUSIVE, reasons

    if ev_delta is None or standard_error is None:
        reasons.append("ev_delta or standard_error is unknown -- cannot classify")
        return AblationResult.INCONCLUSIVE, reasons

    if standard_error <= 0:
        reasons.append("non-positive standard error -- cannot compute a confidence interval")
        return AblationResult.INCONCLUSIVE, reasons

    z_975 = 1.959963984540054  # standard normal 97.5th percentile, for a 95% two-sided CI
    ci_lower = ev_delta - z_975 * standard_error
    ci_upper = ev_delta + z_975 * standard_error
    ci_excludes_zero = ci_lower > 0 or ci_upper < 0

    if not ci_excludes_zero:
        # The CI straddles zero -- distinguish "tight around zero" (a
        # real null result, NEUTRAL) from "too wide to tell" (INCONCLUSIVE).
        ci_half_width = z_975 * standard_error
        if ci_half_width <= meaningful_effect_size:
            reasons.append(f"95% CI [{ci_lower:.4f}, {ci_upper:.4f}] straddles zero but is tight (half-width {ci_half_width:.4f} <= meaningful effect size {meaningful_effect_size}) -- a genuine null result")
            return AblationResult.NEUTRAL, reasons
        reasons.append(f"95% CI [{ci_lower:.4f}, {ci_upper:.4f}] straddles zero and is too wide (half-width {ci_half_width:.4f} > meaningful effect size {meaningful_effect_size}) to distinguish improvement from no effect")
        return AblationResult.INCONCLUSIVE, reasons

    if abs(ev_delta) < meaningful_effect_size:
        reasons.append(f"CI excludes zero but |delta|={abs(ev_delta):.4f} is below the meaningful effect size {meaningful_effect_size} -- statistically real but economically trivial")
        return AblationResult.NEUTRAL, reasons

    if ev_delta > 0:
        reasons.append(f"95% CI [{ci_lower:.4f}, {ci_upper:.4f}] excludes zero and is positive, exceeding the meaningful effect size -- genuine improvement")
        return AblationResult.IMPROVES, reasons

    reasons.append(f"95% CI [{ci_lower:.4f}, {ci_upper:.4f}] excludes zero and is negative, exceeding the meaningful effect size -- genuine degradation")
    return AblationResult.DEGRADES, reasons


def paired_mean_difference(
    baseline_observations: Sequence[float],
    treatment_observations: Sequence[float],
) -> Tuple[Optional[float], Optional[float]]:
    """Paired-difference mean/standard-error, the statistic ablation.py
    must use: a baseline-vs-baseline+feature ablation is ALWAYS a paired
    comparison (the exact same chains/episodes, re-scored with and
    without the added feature), never two independent samples -- Codex
    review flagged an earlier version of this module for using Welch's
    unpaired test here, which both discards the correlation between the
    paired arms (understating the true precision of the comparison, since
    it ignores that per-episode noise common to both arms cancels in the
    difference) and requires the two sequences to be independently drawn,
    which a same-episode ablation never is.

    `baseline_observations[i]` and `treatment_observations[i]` MUST be
    the same episode's baseline and treatment outcome, index-aligned by
    the caller -- this function does not (and cannot) verify pairing
    beyond requiring equal length. Returns (None, None) if the sequences
    have mismatched lengths or fewer than 2 paired observations (no
    variance estimate possible for the paired differences)."""
    if len(baseline_observations) != len(treatment_observations):
        return None, None
    n = len(baseline_observations)
    if n < 2:
        return None, None

    differences = [t - b for b, t in zip(baseline_observations, treatment_observations)]
    mean_diff = sum(differences) / n
    variance_diff = sum((d - mean_diff) ** 2 for d in differences) / (n - 1)
    standard_error = math.sqrt(variance_diff / n)
    return mean_diff, standard_error


def welch_mean_difference(
    baseline_observations: Sequence[float],
    treatment_observations: Sequence[float],
) -> Tuple[Optional[float], Optional[float]]:
    """Welch's unequal-variance mean-difference test statistic
    components: (delta, standard_error), where delta = mean(treatment) -
    mean(baseline), for genuinely INDEPENDENT samples (e.g. two disjoint
    candidate universes evaluated separately, never the same episodes
    scored twice). Do NOT use this for a feature-family ablation --
    baseline and baseline+feature are always the same episodes, and
    `paired_mean_difference` above is the statistically correct choice
    there; this function is kept only for the genuinely-independent-
    samples case, where it remains appropriate. Returns (None, None) if
    either sample has fewer than 2 observations (no variance estimate
    possible)."""
    if len(baseline_observations) < 2 or len(treatment_observations) < 2:
        return None, None

    n_b, n_t = len(baseline_observations), len(treatment_observations)
    mean_b = sum(baseline_observations) / n_b
    mean_t = sum(treatment_observations) / n_t
    var_b = sum((x - mean_b) ** 2 for x in baseline_observations) / (n_b - 1)
    var_t = sum((x - mean_t) ** 2 for x in treatment_observations) / (n_t - 1)

    standard_error = math.sqrt(var_b / n_b + var_t / n_t)
    delta = mean_t - mean_b
    return delta, standard_error
