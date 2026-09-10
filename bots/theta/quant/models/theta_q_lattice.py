"""THETA-Q conventional candidate lattice -- a RESEARCH grid, not production
truth (TRD Appendix I: "these are research grids and benchmark policies, not
universal profitable rules").

Generates the full feasible set of (expiration, strike/delta-band)
candidates across a DTE window and MULTIPLE delta/moneyness bands, applying
only liquidity/event exclusions -- it never narrows to one hand-picked
delta. ``LatticeConfig`` enforces at least two delta bands at construction
time specifically because "never choose only 0.20 or 0.25 delta" is a
structural requirement here, not a reminder to follow by convention.

WAIT is always present in the result as an explicit alternative (CAND-001)
-- every candidate is meant to be evaluated against the exact same
timestamp's alternatives, WAIT included, not against an implicit "do
nothing" default.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from models.common import ReasonCode

WAIT_MARKER = "WAIT"


@dataclass(frozen=True)
class LatticeConfig:
    config_version: str
    min_dte: int
    max_dte: int
    delta_bands: Tuple[Tuple[float, float], ...]  # e.g. ((0.10,0.15), (0.15,0.20), (0.20,0.25), (0.25,0.30))
    min_open_interest: int
    min_volume: int
    max_spread_pct: float
    earnings_exclusion_days: int

    def __post_init__(self) -> None:
        if len(self.delta_bands) < 2:
            raise ValueError(
                "LatticeConfig requires at least two delta_bands -- a single "
                "band (e.g. only 0.20 or only 0.25 delta) is exactly what "
                "this research lattice exists to avoid."
            )
        if self.min_dte > self.max_dte:
            raise ValueError("min_dte must be <= max_dte")


@dataclass(frozen=True)
class ChainContract:
    underlying_symbol: str
    expiration_dte: int
    strike: float
    put_delta_magnitude: float  # 0..1, magnitude only (sign convention handled by the caller)
    spread_pct: Optional[float]
    open_interest: Optional[int]
    volume: Optional[int]
    earnings_distance_days: Optional[int]


@dataclass(frozen=True)
class LatticeCandidate:
    contract: ChainContract
    delta_band: Tuple[float, float]
    reasons: List[ReasonCode]


@dataclass(frozen=True)
class LatticeResult:
    eligible: List[LatticeCandidate]
    rejected: List[LatticeCandidate]
    includes_wait: bool  # always True -- documents the invariant rather than hiding it


def _delta_band_for(delta: float, bands: Sequence[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    for lo, hi in bands:
        if lo <= delta < hi:
            return (lo, hi)
    return None


def build_candidate_grid(
    chain: Sequence[ChainContract], config: LatticeConfig
) -> LatticeResult:
    eligible: List[LatticeCandidate] = []
    rejected: List[LatticeCandidate] = []

    for contract in chain:
        reasons: List[ReasonCode] = []

        if not (config.min_dte <= contract.expiration_dte <= config.max_dte):
            reasons.append(ReasonCode(
                "DTE_OUTSIDE_LATTICE", -1,
                f"expiration_dte={contract.expiration_dte} outside [{config.min_dte}, {config.max_dte}]",
            ))

        band = _delta_band_for(contract.put_delta_magnitude, config.delta_bands)
        if band is None:
            reasons.append(ReasonCode(
                "DELTA_OUTSIDE_ALL_BANDS", -1,
                f"put_delta_magnitude={contract.put_delta_magnitude} does not fall in any configured band",
            ))

        # UNKNOWN and known-but-below-floor are distinguished, never
        # conflated into one reason code -- R6 must be able to tell a real
        # liquidity rejection apart from a data-availability gap.
        if contract.spread_pct is None:
            reasons.append(ReasonCode("SPREAD_UNKNOWN", -1, "Spread is UNKNOWN, not assumed acceptable."))
        elif contract.spread_pct > config.max_spread_pct:
            reasons.append(ReasonCode("SPREAD_TOO_WIDE", -1, f"spread_pct={contract.spread_pct} exceeds max_spread_pct={config.max_spread_pct}."))
        if contract.open_interest is None:
            reasons.append(ReasonCode("OPEN_INTEREST_UNKNOWN", -1, "Open interest is UNKNOWN, not assumed acceptable or zero."))
        elif contract.open_interest < config.min_open_interest:
            reasons.append(ReasonCode("OPEN_INTEREST_BELOW_FLOOR", -1, f"open_interest={contract.open_interest} below floor={config.min_open_interest}."))
        if contract.volume is None:
            reasons.append(ReasonCode("VOLUME_UNKNOWN", -1, "Volume is UNKNOWN, not assumed acceptable or zero."))
        elif contract.volume < config.min_volume:
            reasons.append(ReasonCode("VOLUME_BELOW_FLOOR", -1, f"volume={contract.volume} below floor={config.min_volume}."))
        if (
            contract.earnings_distance_days is not None
            and contract.earnings_distance_days <= config.earnings_exclusion_days
        ):
            reasons.append(ReasonCode(
                "EARNINGS_TOO_NEAR", -1, f"earnings_distance_days={contract.earnings_distance_days}"
            ))

        candidate = LatticeCandidate(
            contract=contract,
            delta_band=band if band is not None else (0.0, 0.0),
            reasons=reasons,
        )
        if reasons:
            rejected.append(candidate)
        else:
            eligible.append(candidate)

    return LatticeResult(eligible=eligible, rejected=rejected, includes_wait=True)
