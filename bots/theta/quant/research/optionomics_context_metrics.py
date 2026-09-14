"""Research consumer for Codex's new Optionomics METRICS context family
(`src/theta/optionomics-provider.ts::normalizeMetrics`, canonical main
`1a00fa9`).

Unlike `Candidate.contract`/`market`/`volatility` (still genuinely opaque
-- see the standing `RESEARCH_HANDOFF` in `research_family_adapters.py`),
this module's field names are NOT a guess: they are the exact logical key
names Codex's own `normalizeMetrics` function produces, read directly from
`src/theta/optionomics-provider.ts` at commit `1a00fa9` --

    atmIv <- atm_iv                         ivRank <- iv_rank
    ivPercentile <- iv_percentile           termSlope <- vol_term_structure_slope
    volatilityRiskPremium20d <- vrp_20      impliedVolatilitySkewZScore <- iv_skew_z_score
    riskReversal25 <- rr25                  totalGex <- total_gex
    putWall <- put_wall                     callWall <- call_wall
    gammaFlipStrike <- gamma_flip_strike    maxPainStrike <- max_pain_strike
    ... (see `_KNOWN_FIELDS` below for the complete confirmed list)

Every value on the provider side already carries its own KNOWN/UNKNOWN/
INVALID state (`OptionomicsProviderValue<T>`) -- this module preserves
that three-state distinction exactly, adding no new interpretation. Units
stay `PROVIDER_REPORTED_UNVERIFIED` for every exposure/sign-bearing
field, matching Codex's own explicit refusal to assert a sign convention.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional, Tuple


class MetricValueState(str, Enum):
    """Mirrors `OptionomicsValueState` in `optionomics-provider.ts` exactly."""

    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"


@dataclass(frozen=True)
class ProviderMetricValue:
    """Mirrors `OptionomicsProviderValue<T>` exactly -- state/value/reason/
    units all travel together, never collapsed to a bare number."""

    state: MetricValueState
    value: Optional[float]
    reason: Optional[str]
    units: str  # 'PROVIDER_REPORTED_UNVERIFIED' | 'COUNT' | 'TIMESTAMP' | 'TEXT'

    @property
    def is_known(self) -> bool:
        return self.state == MetricValueState.KNOWN


#: The confirmed logical-field-name -> provider-key-name mapping, exactly
#: as it appears in `normalizeMetrics`. Any TS-side rename must update
#: this tuple, or `parse_metrics_normalized` below will correctly report
#: the field UNKNOWN rather than silently reading nothing.
_KNOWN_FIELDS: Tuple[str, ...] = (
    "atmIv", "ivRank", "ivPercentile",
    "realizedVolatility5d", "realizedVolatility10d", "realizedVolatility20d",
    "realizedVolatility30d", "realizedVolatility60d",
    "ivMinusRealizedVolatility20d", "impliedVolatilityPremium20d", "volatilityRiskPremium20d",
    "impliedVolatilitySkewZScore", "riskReversal25", "termSlope",
    "expectedMoveLower", "expectedMoveUpper", "expectedMovePercent",
    "totalGex", "callGammaExposure", "putGammaExposure",
    "callDeltaExposure", "putDeltaExposure", "totalDeltaExposure", "deltaExposureDelta",
    "gammaFlipStrike", "putWall", "callWall", "maxPainStrike",
    "putCallVolumeRatio", "putCallOpenInterestRatio", "putCallPremiumRatio",
    "putCallDeltaExposureRatio", "putCallGammaExposureRatio",
)


@dataclass(frozen=True)
class OptionomicsMetricsSnapshot:
    """One underlying's METRICS context observation, fully typed. Every
    field is a `ProviderMetricValue` -- callers must check `.is_known`
    before using `.value`, exactly as the TS side requires."""

    underlying: str
    observed_at: str
    provider_timestamp: Optional[str]
    response_hash: str
    fields: Dict[str, ProviderMetricValue]

    def get(self, logical_name: str) -> ProviderMetricValue:
        """Returns the field's value, or an honest UNKNOWN if this
        snapshot never carried that field at all (e.g. an older
        contract-version observation) -- never a KeyError, never a
        silent None masquerading as zero."""
        return self.fields.get(
            logical_name,
            ProviderMetricValue(MetricValueState.UNKNOWN, None, "FIELD_NOT_PRESENT_IN_THIS_SNAPSHOT", "PROVIDER_REPORTED_UNVERIFIED"),
        )


def _parse_provider_value(raw: Any) -> ProviderMetricValue:
    """Parses one `OptionomicsProviderValue<T>`-shaped JSON object
    (`{state, value, reason, units}`) as persisted/exported. Anything
    that doesn't match that exact shape is reported INVALID -- never
    coerced into a guessed number."""
    if not isinstance(raw, dict):
        return ProviderMetricValue(MetricValueState.INVALID, None, "MALFORMED_PROVIDER_VALUE_SHAPE", "PROVIDER_REPORTED_UNVERIFIED")
    state_raw = raw.get("state")
    try:
        state = MetricValueState(state_raw)
    except ValueError:
        return ProviderMetricValue(MetricValueState.INVALID, None, f"UNKNOWN_STATE_LITERAL:{state_raw!r}", "PROVIDER_REPORTED_UNVERIFIED")
    value = raw.get("value")
    numeric_value: Optional[float] = None
    if state == MetricValueState.KNOWN:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return ProviderMetricValue(MetricValueState.INVALID, None, "KNOWN_STATE_BUT_VALUE_NOT_NUMERIC", "PROVIDER_REPORTED_UNVERIFIED")
        numeric_value = float(value)
    reason = raw.get("reason")
    units = raw.get("units") if isinstance(raw.get("units"), str) else "PROVIDER_REPORTED_UNVERIFIED"
    return ProviderMetricValue(state, numeric_value, reason if isinstance(reason, str) else None, units)


def parse_metrics_normalized(
    underlying: str, observed_at: str, provider_timestamp: Optional[str], response_hash: str,
    normalized: Dict[str, Any],
) -> OptionomicsMetricsSnapshot:
    """Parses the `normalized` record `normalizeMetrics` produces into a
    typed `OptionomicsMetricsSnapshot`. A field present in `_KNOWN_FIELDS`
    but absent from `normalized` becomes UNKNOWN via `OptionomicsMetrics
    Snapshot.get`, never fabricated here."""
    fields: Dict[str, ProviderMetricValue] = {}
    for logical_name in _KNOWN_FIELDS:
        if logical_name in normalized:
            fields[logical_name] = _parse_provider_value(normalized[logical_name])
    return OptionomicsMetricsSnapshot(
        underlying=underlying, observed_at=observed_at, provider_timestamp=provider_timestamp,
        response_hash=response_hash, fields=fields,
    )


def provider_reported_term_slope(snapshot: OptionomicsMetricsSnapshot) -> Optional[float]:
    """The provider's own `termSlope` (<- `vol_term_structure_slope`), for
    direct comparison against this branch's independently-computed
    `term_structure_research.TermMethod.PROVIDER_TERM_METRIC` slot. None
    -- never 0.0 -- whenever the field is UNKNOWN/INVALID/absent."""
    field = snapshot.get("termSlope")
    return field.value if field.is_known else None


def provider_reported_vrp_20d(snapshot: OptionomicsMetricsSnapshot) -> Optional[float]:
    """The provider's own 20-day volatility risk premium (`vrp_20`), for
    direct comparison against this branch's independently-computed
    `iv_realized_vol_research.compute_vrp`. Horizon alignment (is this
    genuinely a 20-day-horizon comparison) remains the CALLER's
    responsibility -- this function only extracts the value."""
    field = snapshot.get("volatilityRiskPremium20d")
    return field.value if field.is_known else None


#: Structural-context fields whose SIGN and even MAGNITUDE convention the
#: provider has not documented (matches `optionomics-provider.ts`'s own
#: `signConvention: 'PROVIDER_DEFINITION_UNVERIFIED'` for the heatmap, and
#: this repository's standing refusal to assume GEX sign/units). Any
#: research use of these fields must treat them as an UNVERIFIED-
#: convention numeric input, never as a directional signal by itself.
UNVERIFIED_SIGN_CONVENTION_FIELDS: Tuple[str, ...] = (
    "totalGex", "callGammaExposure", "putGammaExposure",
    "callDeltaExposure", "putDeltaExposure", "totalDeltaExposure", "deltaExposureDelta",
)
