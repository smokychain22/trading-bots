"""UNUSUAL_ACTIVITY feature (THETA long-run build, work package 10, Phase
2 feature family: UNUSUAL_ACTIVITY).

A robust-statistic baseline comparator: `current metric` vs a rolling
historical `baseline window`, scored by a robust z-like statistic (median +
MAD, not mean/stdev -- resistant to the single large outlier print the
master command explicitly warns against hardcoding as "unusual"). Never a
bare binary; returns REAL/PARTIAL_REAL/UNKNOWN via the canonical
FeatureResult states, plus an explicit `score`/`baselineN`/`coverage` in
the structured value.
"""

from dataclasses import dataclass
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    return ordered[mid] if n % 2 == 1 else (ordered[mid - 1] + ordered[mid]) / 2.0


def robust_z_score(current: float, baseline: Sequence[float]) -> Optional[float]:
    """`(current - median) / (1.4826 * MAD)` -- the constant makes MAD a
    consistent estimator of the standard deviation under normality, the
    standard robust-z convention. Returns `None` (never a fabricated
    score) when the baseline has zero spread (every baseline value
    identical) -- a z-score is not honestly defined there.
    """
    if len(baseline) == 0:
        return None
    median = _median(baseline)
    absolute_deviations = [abs(value - median) for value in baseline]
    mad = _median(absolute_deviations)
    if mad == 0.0:
        return None
    return (current - median) / (1.4826 * mad)


@dataclass(frozen=True)
class UnusualActivityInput:
    option_symbol: str
    current_metric: Optional[float]  # e.g. today's option volume, or flow premium
    baseline_window: Sequence[float]  # historical values of the same metric, already PIT-cutoff-filtered by the caller
    min_baseline_n: int
    event_context_known: bool  # True if the caller has confirmed no ambiguous same-day event; False = ambiguity noted
    as_of: str
    retrieved_at: str


def unusual_activity_result(
    observation: UnusualActivityInput, unusual_threshold: float = 3.0, version: str = "uoa-robust-z-v1",
) -> FeatureResult:
    feature_id = f"UOA_{observation.option_symbol}"
    if observation.current_metric is None:
        return FeatureResult(
            feature_id=feature_id, family="UNUSUAL_ACTIVITY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="robust_z_score", source_provider="INTERNAL_DERIVED", source_operation="robust_z_score",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None,
            coverage=None, version=version, reason_codes=("UOA_UNKNOWN:current_metric_missing",),
        )
    baseline_n = len(observation.baseline_window)
    if baseline_n < observation.min_baseline_n:
        return FeatureResult(
            feature_id=feature_id, family="UNUSUAL_ACTIVITY", state=FeatureResultState.INSUFFICIENT_SAMPLE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="robust_z_score", source_provider="INTERNAL_DERIVED", source_operation="robust_z_score",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None,
            coverage=baseline_n / max(1, observation.min_baseline_n), version=version,
            reason_codes=(f"UOA_INSUFFICIENT_SAMPLE:{baseline_n}_of_{observation.min_baseline_n}_required",),
        )
    score = robust_z_score(observation.current_metric, observation.baseline_window)
    if score is None:
        return FeatureResult(
            feature_id=feature_id, family="UNUSUAL_ACTIVITY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="robust_z_score", source_provider="INTERNAL_DERIVED", source_operation="robust_z_score",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None,
            coverage=1.0, version=version, reason_codes=("UOA_UNKNOWN:zero_spread_baseline",),
        )
    truth_class = FeatureTruthClass.DERIVED_FROM_OBSERVED if observation.event_context_known else FeatureTruthClass.MODELED_RESEARCH
    reason = "UOA_OK" if observation.event_context_known else "UOA_OK:EVENT_CONTEXT_AMBIGUOUS"
    return FeatureResult(
        feature_id=feature_id, family="UNUSUAL_ACTIVITY", state=FeatureResultState.OK,
        truth_class=truth_class, value=None,
        structured_value={
            "score": score, "baselineN": baseline_n, "isUnusual": abs(score) >= unusual_threshold,
            "eventContextKnown": observation.event_context_known,
        },
        units="robust_z_score", source_provider="INTERNAL_DERIVED", source_operation="robust_z_score",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None,
        coverage=1.0, version=version, reason_codes=(reason,),
    )
