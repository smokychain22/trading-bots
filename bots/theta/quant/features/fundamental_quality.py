"""FUNDAMENTAL_QUALITY feature (THETA long-run build, work package 17,
Phase 2 feature family: FUNDAMENTAL_QUALITY).

Real search performed: no authorized fundamental-data provider (earnings
quality, balance-sheet, credit-rating, or similar) exists anywhere in this
repository's provider layer. Per work package 17's explicit instruction,
this module does NOT fetch fundamental data from any unauthorized source.
It implements the typed contract, an explicit UNKNOWN/non-decisive gate,
and the exact missing-provider handoff -- the identical discipline
`sector.py` (work package 13) already established for the same situation.

CODEX_HANDOFF (WP17): to make this family real, Codex must supply a
provider-attributed fundamental-quality score/metric through a legitimate,
already-authorized provider (Alpaca or Optionomics) or an explicitly
owner-approved reference dataset. Until then this feature must remain
UNKNOWN and non-decisive in any Production gate.
"""

from dataclasses import dataclass
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class FundamentalQualityObservation:
    underlying_symbol: str
    metric_name: Optional[str]  # None until a real, authorized provider supplies one
    metric_value: Optional[float]
    provider: Optional[str]
    as_of: str
    retrieved_at: str


def fundamental_quality_result(
    observation: FundamentalQualityObservation, version: str = "fundamental-quality-v1",
) -> FeatureResult:
    feature_id = f"FUNDAMENTAL_QUALITY_{observation.underlying_symbol}"
    if observation.metric_name is None or observation.metric_value is None or observation.provider is None:
        return FeatureResult(
            feature_id=feature_id, family="FUNDAMENTAL_QUALITY", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="provider_defined", source_provider=observation.provider or "NONE_AUTHORIZED",
            source_operation="fundamental_quality_result", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=("FUNDAMENTAL_QUALITY_UNKNOWN:no_authorized_provider_wired_CODEX_HANDOFF_WP17",),
        )
    return FeatureResult(
        feature_id=feature_id, family="FUNDAMENTAL_QUALITY", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=observation.metric_value, structured_value=None,
        units="provider_defined", source_provider=observation.provider, source_operation="fundamental_quality_result",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
        version=version, reason_codes=(f"FUNDAMENTAL_QUALITY_OK:{observation.metric_name}",),
    )
