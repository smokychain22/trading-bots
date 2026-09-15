"""DEX / Vanna / Charm deep research (P2C pass 2, directive sections 5-8):
definitions, units, sign-convention distinctness, and a temporal-change
interface for exposure Greeks -- none of it a trade command.

## DEX (Delta Exposure)
Aggregate dealer-facing delta exposure, typically reported per-contract as
`delta * OI * multiplier * spot` (a dollar-delta convention) summed with a
sign assumption for who is "long" that delta (customer-long-calls-implies-
dealer-short-calls is the common assumption, exactly as unverified here as
the GEX sign convention already documented in `gex_spot_scan_research.py`).
Units: dollars of underlying-equivalent exposure per $1 spot move.
Decision relevance (hypotheses only, never asserted): portfolio-level DEX
concentration near a candidate strike may correlate with dealer hedging
flow that dampens or amplifies moves toward that strike -- untested by
THETA to date. **Never** treated as a directional forecast on its own,
matching this module's own standing GEX discipline.

## Vanna
`dVega/dSpot` = `dDelta/dSigma` (the two are mathematically identical by
Schwarz's theorem for BS-style pricing functions). Units: change in vega
per $1 spot move (equivalently, change in delta per 1-vol-point change in
IV). Sign depends on moneyness and time-to-expiry -- there is no single
"positive Vanna" fact independent of the contract's strike/spot/T
relationship, which is precisely why a blanket "Vanna positive -> buy/sell"
rule is invalid on its face, not just empirically unproven. Aggregate
portfolio/dealer Vanna exposure additionally inherits the same unverified
long/short-assumption problem as DEX/GEX.

## Charm
`dDelta/dTime` (equivalently `-dTheta/dSpot`). Units: delta decay per unit
time (commonly reported per day). Charm accelerates near expiry and is
notoriously unstable for 0DTE/near-0DTE contracts (the same instability
regime `gamma_regime_research.py` already flags for GEX) -- a contract's
delta can shift meaningfully overnight purely from time passing, with spot
unchanged. Decision relevance (hypotheses only): elevated Charm on a
held short-DTE position may signal accelerating delta drift worth
incorporating into HOLD/CLOSE/ROLL context, particularly combined with
pinning behavior late in the session -- untested.

## Standing discipline (identical to `gex_spot_scan_research.py`)
Every one of DEX/Vanna/Charm here is a CONTEXT FEATURE. No function in this
module or its callers may emit a trade recommendation from a Greek-exposure
sign alone.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class ExposureGreek(str, Enum):
    DEX = "DEX"
    VANNA = "VANNA"
    CHARM = "CHARM"


class ExposureProvenance(str, Enum):
    PROVIDER_FACT = "PROVIDER_FACT"  # as reported by Optionomics or another provider, methodology unverified
    THETA_DERIVED = "THETA_DERIVED"  # computed independently by THETA from BS reference math


@dataclass(frozen=True)
class ExposureSignConvention:
    """Mirrors `gex_spot_scan_research.GexSignConvention` exactly -- a named,
    caller-justified assumption about which side (customer vs. dealer) is
    long, never a silent default. Two convention IDs are considered
    COMPATIBLE only when this field matches; the temporal-change function
    below refuses to diff exposures carrying different `convention_id`s."""

    convention_id: str
    verified: bool


class ExposureTemporalState(str, Enum):
    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"
    INVALID = "INVALID"


@dataclass(frozen=True)
class ExposureObservation:
    greek: ExposureGreek
    underlying: str
    observed_at: str  # ISO-8601
    value: Optional[float]
    provenance: ExposureProvenance
    sign_convention: ExposureSignConvention
    scope_key: str  # e.g. "PORTFOLIO", "STRIKE:105", "EXPIRY:2026-10-16" -- must match between observations


@dataclass(frozen=True)
class ExposureTemporalChange:
    state: ExposureTemporalState
    greek: Optional[ExposureGreek]
    absolute_change: Optional[float]
    elapsed_seconds: Optional[float]
    rate_per_hour: Optional[float]
    reason: Optional[str]


def _parse(ts: str) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def derive_exposure_temporal_change(
    earlier: ExposureObservation,
    current: ExposureObservation,
    maximum_gap_seconds: float,
) -> ExposureTemporalChange:
    """Mirrors `optionomics_flow_temporal_research.derive_flow_delta`'s exact
    discipline (same underlying/scope, strict causal ordering, caller-
    supplied bounded gap, UNKNOWN/INVALID propagation, no fabricated zero),
    extended with the ONE thing exposure Greeks require that flow does not:
    refusing to diff two observations whose sign conventions are not
    provably the SAME (`convention_id` mismatch, or provider-vs-THETA-
    derived provenance mismatch) -- comparing a provider value against a
    THETA-derived value under an unverified or differing convention would
    silently fabricate a "change" that is actually just a methodology
    switch."""
    if earlier.greek != current.greek:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, None, None, None, None, "GREEK_MISMATCH")
    if earlier.underlying != current.underlying:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "UNDERLYING_MISMATCH")
    if earlier.scope_key != current.scope_key:
        return ExposureTemporalChange(ExposureTemporalState.UNKNOWN, current.greek, None, None, None, "SCOPE_MISMATCH")
    if earlier.provenance != current.provenance:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "PROVENANCE_MISMATCH_PROVIDER_VS_THETA_DERIVED")
    if earlier.sign_convention.convention_id != current.sign_convention.convention_id:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "INCOMPATIBLE_SIGN_CONVENTION")

    earlier_ts, current_ts = _parse(earlier.observed_at), _parse(current.observed_at)
    if earlier_ts is None or current_ts is None:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "UNPARSEABLE_TIMESTAMP")
    if current_ts <= earlier_ts:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "NON_CAUSAL_ORDERING")
    if maximum_gap_seconds <= 0:
        return ExposureTemporalChange(ExposureTemporalState.INVALID, current.greek, None, None, None, "MAXIMUM_GAP_MUST_BE_POSITIVE")

    elapsed = (current_ts - earlier_ts).total_seconds()
    if elapsed > maximum_gap_seconds:
        return ExposureTemporalChange(ExposureTemporalState.UNKNOWN, current.greek, None, elapsed, None, "GAP_EXCEEDS_MAXIMUM")

    if earlier.value is None or current.value is None:
        return ExposureTemporalChange(ExposureTemporalState.UNKNOWN, current.greek, None, elapsed, None, "MISSING_VALUE")

    absolute_change = current.value - earlier.value
    return ExposureTemporalChange(
        ExposureTemporalState.KNOWN, current.greek, absolute_change, elapsed,
        absolute_change * 3600.0 / elapsed, None,
    )
