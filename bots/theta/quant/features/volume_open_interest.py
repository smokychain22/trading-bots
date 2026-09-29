"""VOLUME_OPEN_INTEREST feature (THETA long-run build, work package 08,
Phase 2 feature family: VOLUME_OPEN_INTEREST).

Separates session volume from open interest explicitly -- they are
different provider fields with different semantics (volume is a flow over
the session; OI is a stock, typically updated once per session, not
intraday-live). Missing OI is UNKNOWN, never coerced to zero; a
provider-reported OI of exactly 0 is only accepted as a real zero when the
caller explicitly attests the provider reported it (never inferred from
an absent field).
"""

from dataclasses import dataclass
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class VolumeOpenInterestObservation:
    option_symbol: str
    session_volume: Optional[int]
    open_interest: Optional[int]
    open_interest_explicitly_zero: bool  # True only when the provider itself reported OI=0
    provider_timestamp: str
    as_of: str
    retrieved_at: str
    provider: str = "ALPACA"
    max_oi_age_seconds: Optional[float] = None
    oi_age_seconds: Optional[float] = None


def volume_open_interest_result(
    observation: VolumeOpenInterestObservation, version: str = "volume-oi-v1",
) -> FeatureResult:
    feature_id = f"VOLUME_OI_{observation.option_symbol}"
    if observation.session_volume is None and observation.open_interest is None and not observation.open_interest_explicitly_zero:
        return FeatureResult(
            feature_id=feature_id, family="VOLUME_OPEN_INTEREST", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="contracts", source_provider=observation.provider, source_operation="volume_open_interest_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=("VOLUME_OI_UNKNOWN:no_volume_or_oi_reported",),
        )

    oi_state = "UNKNOWN"
    oi_value = None
    if observation.open_interest is not None:
        if observation.max_oi_age_seconds is not None and observation.oi_age_seconds is not None \
                and observation.oi_age_seconds > observation.max_oi_age_seconds:
            oi_state = "STALE"
        else:
            oi_state = "GOOD"
            oi_value = observation.open_interest
    elif observation.open_interest_explicitly_zero:
        oi_state = "GOOD"
        oi_value = 0

    volume_oi_ratio = None
    if oi_value is not None and oi_value > 0 and observation.session_volume is not None:
        volume_oi_ratio = observation.session_volume / oi_value

    if observation.session_volume is None and oi_value is None:
        return FeatureResult(
            feature_id=feature_id, family="VOLUME_OPEN_INTEREST", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="contracts", source_provider=observation.provider, source_operation="volume_open_interest_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=(f"VOLUME_OI_UNKNOWN:oi_state={oi_state}",),
        )
    return FeatureResult(
        feature_id=feature_id, family="VOLUME_OPEN_INTEREST", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={
            "sessionVolume": observation.session_volume, "openInterest": oi_value, "openInterestState": oi_state,
            "volumeOpenInterestRatio": volume_oi_ratio,
        },
        units="contracts", source_provider=observation.provider, source_operation="volume_open_interest_result",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
        version=version, reason_codes=("VOLUME_OI_OK",),
    )
