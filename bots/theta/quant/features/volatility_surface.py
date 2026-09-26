"""VOLATILITY_SURFACE feature (THETA long-run build, work package 07,
Phase 2 feature family: VOLATILITY_SURFACE).

A compact, structured expiry x delta-bucket grid of real, already-observed
IVs (via `iv.py`) -- never the raw option chain itself (the master command
explicitly prohibits storing a giant raw chain as the feature object).
Each cell is explicitly OBSERVED or MISSING; there is no interpolation
model in this repository yet, so no cell is ever silently interpolated.
"""

from dataclasses import dataclass
from typing import Sequence, Tuple

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass

DEFAULT_DELTA_BUCKETS: Tuple[float, ...] = (0.10, 0.25, 0.40, 0.50)


@dataclass(frozen=True)
class SurfaceCellObservation:
    """One real, already-classified (expiry, delta-bucket) cell."""
    expiration_date: str
    dte: int
    delta_bucket: float
    iv: float


def _nearest_bucket(delta_magnitude: float, buckets: Sequence[float]) -> float:
    return min(buckets, key=lambda bucket: abs(bucket - delta_magnitude))


def volatility_surface_result(
    observations: Sequence[SurfaceCellObservation], delta_buckets: Sequence[float] = DEFAULT_DELTA_BUCKETS,
    min_coverage_ratio: float = 0.0, as_of: str = "", retrieved_at: str = "",
    version: str = "volatility-surface-grid-v1",
) -> FeatureResult:
    """Builds the compact grid. Every (expiry, bucket) cell present in
    `observations` (snapped to the nearest configured `delta_buckets`
    entry) is OBSERVED; expiries actually seen but missing a specific
    bucket are recorded as MISSING cells -- never silently absent from the
    grid, so a consumer can see exactly what coverage looked like.
    """
    feature_id = "VOLATILITY_SURFACE_GRID"
    if len(observations) == 0:
        return FeatureResult(
            feature_id=feature_id, family="VOLATILITY_SURFACE", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_grid", source_provider="INTERNAL_DERIVED", source_operation="volatility_surface_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=0.0, version=version,
            reason_codes=("VOLATILITY_SURFACE_INSUFFICIENT_COVERAGE:no_observations",),
        )
    expiries = sorted({observation.expiration_date for observation in observations},
                      key=lambda expiration: next(o.dte for o in observations if o.expiration_date == expiration))
    grid_by_expiry_bucket = {}
    for observation in observations:
        bucket = _nearest_bucket(observation.delta_bucket, delta_buckets)
        grid_by_expiry_bucket[(observation.expiration_date, bucket)] = observation.iv

    cells = []
    observed_count = 0
    for expiration in expiries:
        for bucket in delta_buckets:
            iv = grid_by_expiry_bucket.get((expiration, bucket))
            if iv is None:
                cells.append({"expirationDate": expiration, "deltaBucket": bucket, "state": "MISSING", "iv": None})
            else:
                cells.append({"expirationDate": expiration, "deltaBucket": bucket, "state": "OBSERVED", "iv": iv})
                observed_count += 1
    total_cells = len(expiries) * len(delta_buckets)
    coverage_ratio = observed_count / total_cells if total_cells > 0 else 0.0
    if coverage_ratio < min_coverage_ratio:
        return FeatureResult(
            feature_id=feature_id, family="VOLATILITY_SURFACE", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_grid", source_provider="INTERNAL_DERIVED", source_operation="volatility_surface_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=coverage_ratio, version=version,
            reason_codes=(f"VOLATILITY_SURFACE_INSUFFICIENT_COVERAGE:{coverage_ratio}_below_{min_coverage_ratio}",),
        )
    return FeatureResult(
        feature_id=feature_id, family="VOLATILITY_SURFACE", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=None,
        structured_value={"cells": cells, "expiries": expiries, "deltaBuckets": list(delta_buckets),
                           "observedCellCount": observed_count, "totalCellCount": total_cells},
        units="iv_grid", source_provider="INTERNAL_DERIVED", source_operation="volatility_surface_result",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=coverage_ratio, version=version,
        reason_codes=("VOLATILITY_SURFACE_OK",),
    )
