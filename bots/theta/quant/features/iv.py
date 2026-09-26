"""IV feature (THETA long-run build, work package 04, Phase 2 feature
family: IV).

Transforms an already-fetched, provider-normalized single-contract
observation into the canonical FeatureResult contract
(`feature_contract.py`). This module does NOT fetch anything and does NOT
compute a model-implied IV from a midpoint -- it only classifies and
re-shapes a real provider-reported IV field, exactly as `TERM_STRUCTURE`
(work package 06) will do for multiple expiries and `SKEW` (work package
05) will do across delta buckets.

Truth class: a provider-reported IV is `MARKET_OBSERVED` (the provider
itself computed it from real quotes/model conventions it owns) -- this
module never mislabels it `MODELED_RESEARCH`, and never fabricates an IV
value when the provider did not supply one (that case is `UNKNOWN`, not a
guessed IV from bid/ask midpoint, per the master command's explicit
prohibition on inventing an "observed IV").
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class IvContractObservation:
    """The minimal real fields this module needs, already normalized by
    the caller (this repo's existing provider-adapter layer owns that
    normalization -- this module trusts contract identity fields are
    already validated, matching every other feature module's division of
    labor)."""
    option_symbol: str
    underlying_symbol: str
    expiration_date: str  # ISO date, e.g. "2026-10-16"
    strike: float
    option_type: str  # "PUT" or "CALL"
    provider_iv: Optional[float]  # None when the provider genuinely did not report one
    provider_timestamp: Optional[str]
    as_of: str
    retrieved_at: str
    provider: str = "OPTIONOMICS"
    max_quote_age_seconds: Optional[float] = None


def iv_feature_result(
    observation: IvContractObservation, version: str = "iv-provider-observed-v1",
) -> FeatureResult:
    feature_id = f"IV_{observation.option_symbol}"
    if observation.option_type not in ("PUT", "CALL"):
        return FeatureResult(
            feature_id=feature_id, family="IV", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="implied_volatility_annualized", source_provider=observation.provider,
            source_operation="provider_iv_passthrough", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"IV_INVALID:option_type={observation.option_type}",),
        )
    if observation.provider_iv is None or observation.provider_timestamp is None:
        return FeatureResult(
            feature_id=feature_id, family="IV", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="implied_volatility_annualized", source_provider=observation.provider,
            source_operation="provider_iv_passthrough", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=("IV_UNKNOWN:provider_did_not_report_iv",),
        )
    if observation.provider_iv <= 0.0:
        return FeatureResult(
            feature_id=feature_id, family="IV", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="implied_volatility_annualized", source_provider=observation.provider,
            source_operation="provider_iv_passthrough", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=(f"IV_INVALID:non_positive_iv={observation.provider_iv}",),
        )
    freshness_seconds = (_parse_iso(observation.as_of) - _parse_iso(observation.provider_timestamp)).total_seconds()
    if observation.max_quote_age_seconds is not None and freshness_seconds > observation.max_quote_age_seconds:
        return FeatureResult(
            feature_id=feature_id, family="IV", state=FeatureResultState.STALE,
            truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None, structured_value=None,
            units="implied_volatility_annualized", source_provider=observation.provider,
            source_operation="provider_iv_passthrough", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=freshness_seconds, coverage=None, version=version,
            reason_codes=(f"IV_STALE:{freshness_seconds}s_exceeds_{observation.max_quote_age_seconds}s_policy",),
        )
    return FeatureResult(
        feature_id=feature_id, family="IV", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=observation.provider_iv, structured_value=None,
        units="implied_volatility_annualized", source_provider=observation.provider,
        source_operation="provider_iv_passthrough", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
        freshness_seconds=freshness_seconds, coverage=None, version=version,
        reason_codes=("IV_OK",),
    )
