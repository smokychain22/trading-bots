"""TERM_STRUCTURE feature (THETA long-run build, work package 06, Phase 2
feature family: TERM_STRUCTURE).

Builds a compact, DTE-ordered IV term-structure representation from
already-classified per-expiry ATM IV observations (each itself real
provider IV, via `iv.py`) -- never interpolates a missing expiry's IV from
a model this module invents. `state` distinguishes each point as OBSERVED
(a real per-expiry IV was supplied) since this module implements no
interpolation model yet -- a future interpolation challenger would add
INTERPOLATED points explicitly, never silently blend them with observed
ones.

Truth class: DERIVED_FROM_OBSERVED for the overall feature (a real,
classified summary built from real provider IVs), same as SKEW.
"""

from dataclasses import dataclass
from typing import Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class TermStructurePoint:
    """One real, already-classified expiry's ATM IV, for one underlying."""
    underlying_symbol: str
    expiration_date: str
    dte: int
    atm_iv: float
    provider_timestamp: str


def term_structure_result(
    points: Sequence[TermStructurePoint], min_expiries: int = 2,
    as_of: str = "", retrieved_at: str = "", version: str = "term-structure-atm-iv-v1",
) -> FeatureResult:
    """Builds the term-structure curve. Requires every point to share the
    SAME `underlying_symbol` (a caller mixing underlyings gets an explicit
    rejection, never a silently-meaningless cross-underlying curve), and
    at least `min_expiries` distinct expiries (a single-expiry input is
    INSUFFICIENT_COVERAGE, never labeled a "term structure" of one point).
    """
    feature_id = "TERM_STRUCTURE_ATM_IV"
    if len(points) == 0:
        return FeatureResult(
            feature_id=feature_id, family="TERM_STRUCTURE", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_by_dte_curve", source_provider="INTERNAL_DERIVED", source_operation="term_structure_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=0.0, version=version,
            reason_codes=("TERM_STRUCTURE_INSUFFICIENT_COVERAGE:no_points",),
        )
    underlyings = {point.underlying_symbol for point in points}
    if len(underlyings) > 1:
        return FeatureResult(
            feature_id=feature_id, family="TERM_STRUCTURE", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_by_dte_curve", source_provider="INTERNAL_DERIVED", source_operation="term_structure_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"TERM_STRUCTURE_INVALID:mixed_underlyings={sorted(underlyings)}",),
        )
    by_expiry = {point.expiration_date: point for point in points}  # last-write-wins per real expiry, never duplicated
    distinct_expiries = sorted(by_expiry.values(), key=lambda point: point.dte)
    if len(distinct_expiries) < min_expiries:
        return FeatureResult(
            feature_id=feature_id, family="TERM_STRUCTURE", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_by_dte_curve", source_provider="INTERNAL_DERIVED", source_operation="term_structure_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None,
            coverage=len(distinct_expiries) / min_expiries, version=version,
            reason_codes=(f"TERM_STRUCTURE_INSUFFICIENT_COVERAGE:{len(distinct_expiries)}_of_{min_expiries}_required_expiries",),
        )
    curve = [
        {"dte": point.dte, "expirationDate": point.expiration_date, "atmIv": point.atm_iv, "state": "OBSERVED"}
        for point in distinct_expiries
    ]
    front_iv = distinct_expiries[0].atm_iv
    back_iv = distinct_expiries[-1].atm_iv
    slope_state = "CONTANGO" if back_iv > front_iv else ("BACKWARDATION" if back_iv < front_iv else "FLAT")
    return FeatureResult(
        feature_id=feature_id, family="TERM_STRUCTURE", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=None,
        structured_value={"curve": curve, "slopeState": slope_state, "frontIv": front_iv, "backIv": back_iv},
        units="iv_by_dte_curve", source_provider="INTERNAL_DERIVED", source_operation="term_structure_result",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("TERM_STRUCTURE_OK",),
    )
