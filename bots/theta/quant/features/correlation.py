"""CORRELATION feature (THETA long-run build, work package 14, Phase 2
feature family: CORRELATION).

PIT-safe rolling Pearson correlation between two already-aligned close
series (one portfolio pair). Requires paired, same-length series (the
caller owns timestamp alignment -- this module trusts index `i` in both
series is the same real bar for both symbols, matching every other
feature module's division of labor). A constant series (zero variance)
makes correlation mathematically undefined -- returned as UNKNOWN, never
a fabricated 0 or 1.
"""

from dataclasses import dataclass
from math import sqrt
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


def pearson_correlation(a: Sequence[float], b: Sequence[float]) -> Optional[float]:
    if len(a) != len(b):
        raise ValueError("CORRELATION_SERIES_LENGTH_MISMATCH")
    n = len(a)
    if n < 2:
        return None
    mean_a = sum(a) / n
    mean_b = sum(b) / n
    covariance = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n))
    variance_a = sum((value - mean_a) ** 2 for value in a)
    variance_b = sum((value - mean_b) ** 2 for value in b)
    if variance_a == 0.0 or variance_b == 0.0:
        return None  # a constant series -- correlation is undefined, never fabricated
    return covariance / sqrt(variance_a * variance_b)


@dataclass(frozen=True)
class CorrelationPairInput:
    symbol_a: str
    symbol_b: str
    returns_a: Sequence[Optional[float]]
    returns_b: Sequence[Optional[float]]
    as_of_index: int
    lookback: int
    max_bars_since_last: int = 1


def rolling_correlation_result(
    observation: CorrelationPairInput, as_of: str = "", retrieved_at: str = "",
    version: str = "correlation-pearson-v1",
) -> FeatureResult:
    feature_id = f"CORRELATION_{observation.symbol_a}_{observation.symbol_b}_{observation.lookback}"
    if len(observation.returns_a) != len(observation.returns_b):
        return FeatureResult(
            feature_id=feature_id, family="CORRELATION", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="pearson_r", source_provider="INTERNAL_DERIVED", source_operation="pearson_correlation",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=("CORRELATION_INVALID:series_length_mismatch",),
        )
    if observation.as_of_index < 0 or observation.as_of_index >= len(observation.returns_a):
        raise ValueError("CORRELATION_AS_OF_INDEX_OUT_OF_RANGE")

    bars_since_last = (len(observation.returns_a) - 1) - observation.as_of_index
    if bars_since_last > observation.max_bars_since_last:
        return FeatureResult(
            feature_id=feature_id, family="CORRELATION", state=FeatureResultState.STALE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="pearson_r", source_provider="INTERNAL_DERIVED", source_operation="pearson_correlation",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"CORRELATION_STALE:{bars_since_last}_bars_since_as_of",),
        )

    window_a = observation.returns_a[: observation.as_of_index + 1][-observation.lookback:]
    window_b = observation.returns_b[: observation.as_of_index + 1][-observation.lookback:]
    if len(window_a) < observation.lookback or any(value is None for value in window_a) or any(value is None for value in window_b):
        return FeatureResult(
            feature_id=feature_id, family="CORRELATION", state=FeatureResultState.INSUFFICIENT_HISTORY,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="pearson_r", source_provider="INTERNAL_DERIVED", source_operation="pearson_correlation",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"CORRELATION_INSUFFICIENT_HISTORY:{len(window_a)}_of_{observation.lookback}_required",),
        )
    correlation = pearson_correlation(window_a, window_b)  # type: ignore[arg-type]
    if correlation is None:
        return FeatureResult(
            feature_id=feature_id, family="CORRELATION", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="pearson_r", source_provider="INTERNAL_DERIVED", source_operation="pearson_correlation",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=("CORRELATION_UNKNOWN:zero_variance_constant_series",),
        )
    return FeatureResult(
        feature_id=feature_id, family="CORRELATION", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=correlation, structured_value=None,
        units="pearson_r", source_provider="INTERNAL_DERIVED", source_operation="pearson_correlation",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("CORRELATION_OK",),
    )
