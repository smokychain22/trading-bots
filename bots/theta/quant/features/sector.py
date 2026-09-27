"""SECTOR feature (THETA long-run build, work package 13, Phase 2 feature
family: SECTOR).

Real search performed before writing this module: no authorized sector/
GICS-classification data source exists anywhere in this repository
(`bots/theta/quant/models/aegis.py` and `runtime/aegis_contract.py`
consume `sector_concentration_pct` as an externally-supplied
`Optional[float]` -- the same never-computed-input pattern
`realized_volatility.py`/`trend.py` already fixed for their own inputs,
but SECTOR has no producer at all, and unlike those, no legitimate
in-repo data source to compute one from).

Per work package 13's explicit instruction ("If no authorized source:
implement typed UNKNOWN contract and exact Codex/provider handoff, then
continue. Do not scrape random web data."): this module implements the
typed contract and an explicit UNKNOWN result -- it does NOT fetch sector
data from any unauthorized source (no web scraping, no hardcoded GICS
table invented from memory, which could be wrong/stale and would be a
silent, unverifiable data quality risk).

CODEX_HANDOFF (WP13): to make this family real, Codex must supply a
provider-attributed sector classification (per-underlying GICS or
provider-equivalent sector code) through a legitimate, already-authorized
provider (Alpaca or Optionomics) or an explicitly owner-approved reference
dataset -- see `docs/quant/` for the promotion process this would need to
follow (same discipline as SKEW's `RESEARCH_BASELINE` classification: any
new formula/source needs an explicit decision, not a silent default).
"""

from dataclasses import dataclass
from typing import Optional

from features.feature_contract import FeatureResult, FeatureResultState, FeatureTruthClass


@dataclass(frozen=True)
class SectorObservation:
    underlying_symbol: str
    sector_code: Optional[str]  # None until a real, authorized provider supplies one
    sector_classification_scheme: Optional[str]  # e.g. "GICS" -- None while sector_code is None
    provider: Optional[str]
    as_of: str
    retrieved_at: str


def sector_result(observation: SectorObservation, version: str = "sector-v1") -> FeatureResult:
    feature_id = f"SECTOR_{observation.underlying_symbol}"
    if observation.sector_code is None or observation.provider is None:
        return FeatureResult(
            feature_id=feature_id, family="SECTOR", state=FeatureResultState.UNKNOWN,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="sector_code", source_provider=observation.provider or "NONE_AUTHORIZED",
            source_operation="sector_result", as_of=observation.as_of, retrieved_at=observation.retrieved_at,
            freshness_seconds=None, coverage=None, version=version,
            reason_codes=("SECTOR_UNKNOWN:no_authorized_sector_source_wired_CODEX_HANDOFF_WP13",),
        )
    if observation.sector_classification_scheme is None:
        return FeatureResult(
            feature_id=feature_id, family="SECTOR", state=FeatureResultState.INVALID,
            truth_class=FeatureTruthClass.UNKNOWN, value=None, structured_value=None,
            units="sector_code", source_provider=observation.provider, source_operation="sector_result",
            as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
            version=version, reason_codes=("SECTOR_INVALID:sector_code_present_without_a_declared_scheme",),
        )
    return FeatureResult(
        feature_id=feature_id, family="SECTOR", state=FeatureResultState.OK,
        truth_class=FeatureTruthClass.MARKET_OBSERVED, value=None,
        structured_value={"sectorCode": observation.sector_code, "scheme": observation.sector_classification_scheme},
        units="sector_code", source_provider=observation.provider, source_operation="sector_result",
        as_of=observation.as_of, retrieved_at=observation.retrieved_at, freshness_seconds=None, coverage=None,
        version=version, reason_codes=("SECTOR_OK",),
    )
