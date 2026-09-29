"""PORTFOLIO_EXPOSURE feature (THETA long-run build, work package 15,
Phase 2 feature family: PORTFOLIO_EXPOSURE).

Pure quant-side exposure arithmetic over already broker-confirmed
positions supplied by the caller (the application layer owns fetching
real Alpaca positions; this module never infers or fabricates a broker
position of its own -- if the caller has no confirmed positions, that is
an explicit, empty, real fact, not this module's concern to invent).
"""

from dataclasses import dataclass
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class ConfirmedPosition:
    """One broker-confirmed position -- every field here must already be
    real, application-supplied truth (Alpaca is the broker/account truth
    per this repo's canonical rule); this module performs arithmetic only."""
    underlying_symbol: str
    sector_code: Optional[str]
    market_value: float
    shares_held: int  # 0 for an option-only position
    is_covered_call_eligible: bool  # True only if shares_held is enough to cover the option position
    assignment_exposure_notional: float  # notional exposure to a possible assignment, 0.0 if none


def portfolio_exposure_result(
    positions: Sequence[ConfirmedPosition], total_account_value: Optional[float],
    as_of: str, retrieved_at: str, version: str = "portfolio-exposure-v1",
) -> FeatureResult:
    feature_id = "PORTFOLIO_EXPOSURE"
    if total_account_value is None:
        return FeatureResult(
            feature_id=feature_id, family="PORTFOLIO_EXPOSURE", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="portfolio_exposure_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=("PORTFOLIO_EXPOSURE_UNKNOWN:total_account_value_missing",),
        )
    if total_account_value <= 0.0:
        return FeatureResult(
            feature_id=feature_id, family="PORTFOLIO_EXPOSURE", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="usd_and_ratios", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="portfolio_exposure_result",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"PORTFOLIO_EXPOSURE_INVALID:non_positive_account_value={total_account_value}",),
        )

    gross_exposure = sum(abs(position.market_value) for position in positions)
    net_exposure = sum(position.market_value for position in positions)
    by_underlying = {}
    by_sector = {}
    total_assignment_exposure = 0.0
    covered_share_utilization = 0
    for position in positions:
        by_underlying[position.underlying_symbol] = by_underlying.get(position.underlying_symbol, 0.0) + position.market_value
        if position.sector_code is not None:
            by_sector[position.sector_code] = by_sector.get(position.sector_code, 0.0) + position.market_value
        total_assignment_exposure += position.assignment_exposure_notional
        if position.is_covered_call_eligible:
            covered_share_utilization += position.shares_held

    max_underlying_concentration_pct = (
        max((abs(value) for value in by_underlying.values()), default=0.0) / total_account_value
    )
    return FeatureResult(
        feature_id=feature_id, family="PORTFOLIO_EXPOSURE", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=None,
        structured_value={
            "grossExposure": gross_exposure, "netExposure": net_exposure,
            "grossExposurePct": gross_exposure / total_account_value,
            "netExposurePct": net_exposure / total_account_value,
            "byUnderlying": by_underlying, "bySector": by_sector,
            "maxUnderlyingConcentrationPct": max_underlying_concentration_pct,
            "assignmentExposureNotional": total_assignment_exposure,
            "coveredShareUtilization": covered_share_utilization,
            "positionCount": len(positions),
        },
        units="usd_and_ratios", source_provider="APPLICATION_BROKER_CONFIRMED", source_operation="portfolio_exposure_result",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("PORTFOLIO_EXPOSURE_OK",),
    )
