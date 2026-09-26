"""SKEW feature (THETA long-run build, work package 05, Phase 2 feature
family: SKEW).

No canonical THETA-specific skew formula was found in `docs/quant/` or
`bots/theta/quant/research/data/feature_families.json` (searched before
writing this module, per work package 05's explicit "read relevant
canonical docs, do not invent policy silently" instruction) -- SKEW is
named only as a feature family, never defined. This module therefore
implements the standard, widely-documented industry convention (a 25-delta
risk-reversal: call IV minus put IV at the same absolute delta magnitude,
same expiry) as an explicit, labeled BASELINE choice -- not a claim that
this is THETA's own previously-specified policy. Same discipline as
`realized_volatility.py`'s MODEL-001 baseline-first rule.

Truth class: DERIVED_FROM_OBSERVED -- computed from real provider IV
observations (via `iv.py`), never itself a provider-reported field.
"""

from dataclasses import dataclass
from typing import Optional, Sequence

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class SkewWingObservation:
    """One real, already-classified contract's delta and IV, for one side
    (PUT or CALL) of the skew bucket -- built from `iv.py`'s
    `IvContractObservation`/`iv_feature_result` output plus that contract's
    real delta, not re-fetched here."""
    option_type: str  # "PUT" or "CALL"
    delta_magnitude: float  # 0..1, absolute value (sign convention owned by the caller)
    iv: float
    expiration_date: str


def risk_reversal_skew(
    observations: Sequence[SkewWingObservation], target_delta: float = 0.25,
    delta_tolerance: float = 0.05, min_contracts_per_wing: int = 1,
    as_of: str = "", retrieved_at: str = "", version: str = "skew-risk-reversal-25d-v1",
) -> FeatureResult:
    """`call_iv - put_iv` at `target_delta` (default 25-delta), same
    expiry only. A positive value means calls are relatively more
    expensive (a "call skew" / less common for equity/ETF options); a
    negative value is the far more common "put skew" (crash-protection
    premium). Both wings must come from the SAME expiration_date -- a
    caller passing observations from mixed expiries gets an explicit
    rejection, never a silently-wrong cross-expiry number.
    """
    feature_id = f"SKEW_RISK_REVERSAL_{int(target_delta * 100)}D"
    if len(observations) == 0:
        return FeatureResult(
            feature_id=feature_id, family="SKEW", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_difference", source_provider="INTERNAL_DERIVED", source_operation="risk_reversal_skew",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=0.0, version=version,
            reason_codes=("SKEW_INSUFFICIENT_COVERAGE:no_observations",),
        )
    expiries = {observation.expiration_date for observation in observations}
    if len(expiries) > 1:
        return FeatureResult(
            feature_id=feature_id, family="SKEW", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_difference", source_provider="INTERNAL_DERIVED", source_operation="risk_reversal_skew",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"SKEW_INVALID:mixed_expiries={sorted(expiries)}",),
        )

    def _wing(option_type: str) -> Sequence[SkewWingObservation]:
        return [
            observation for observation in observations
            if observation.option_type == option_type
            and abs(observation.delta_magnitude - target_delta) <= delta_tolerance
        ]

    puts = _wing("PUT")
    calls = _wing("CALL")
    coverage = min(len(puts), len(calls)) / max(1, min_contracts_per_wing)
    if len(puts) < min_contracts_per_wing or len(calls) < min_contracts_per_wing:
        missing_wing = "PUT" if len(puts) < min_contracts_per_wing else "CALL"
        return FeatureResult(
            feature_id=feature_id, family="SKEW", state=FeatureResultState.INSUFFICIENT_COVERAGE,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="iv_difference", source_provider="INTERNAL_DERIVED", source_operation="risk_reversal_skew",
            as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=min(1.0, coverage), version=version,
            reason_codes=(f"SKEW_MISSING_WING:{missing_wing}:{len(puts)}_puts_{len(calls)}_calls_found",),
        )

    put_iv = sum(observation.iv for observation in puts) / len(puts)
    call_iv = sum(observation.iv for observation in calls) / len(calls)
    return FeatureResult(
        feature_id=feature_id, family="SKEW", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.DERIVED_FROM_OBSERVED, value=call_iv - put_iv, structured_value=None,
        units="iv_difference", source_provider="INTERNAL_DERIVED", source_operation="risk_reversal_skew",
        as_of=as_of, retrieved_at=retrieved_at, freshness_seconds=None, coverage=1.0, version=version,
        reason_codes=("SKEW_OK",),
    )
