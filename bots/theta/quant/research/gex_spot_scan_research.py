"""Independent spot-scan gamma-flip research methodology -- THETA's own
cross-check against Optionomics' provider-reported `gammaFlipStrike`,
distinct in method and never assumed to agree.

Methodology found and cited from `sgdividends/spx-dealer-gamma` (no
license, method cited not code adopted; see
`docs/research/THETA_CODEX_ACCEPTANCE_AUDIT.md`/`THETA_EXTERNAL_REPO_PATTERN_MATRIX.md`
for the prior-session dossier): recompute each contract's Black-Scholes
gamma at a RANGE of hypothetical spot prices (holding each contract's own
strike/IV/time-to-expiry fixed), aggregate signed exposure at each
hypothetical spot, and find where the aggregate crosses zero. This is a
"spot-scan" -- distinct from reading a single provider-reported value at
the CURRENT spot, which gives only one point on the curve.

Explicit, carried discipline (never violated by this module):
- Sign convention (call OI contributes positively, put OI negatively) is a
  MODELING ASSUMPTION, stated as such in every result, never asserted as
  observed dealer inventory -- mirrors `gamma_regime_research.py`'s own
  `sign_convention_verified` requirement and the source repo's own
  explicit disclaimer.
- THETA's own spot-scan result and Optionomics' provider-reported
  `gammaFlipStrike` are two DIFFERENT measurements with different
  methodologies (this module's own BS-repricing vs. whatever the provider
  computes internally, unverified). They are never merged or averaged;
  both are retained as separately-provenanced facts, matching the dual-
  provenance discipline already verified in
  `options-chain-decision-intelligence.ts`'s `ChainScopedAttachment`
  (`classification: PROVIDER_FACT` vs `THETA_DERIVED`).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Tuple

from research.bs_reference import BsInputs, bs_gamma


class GexSpotScanState(str, Enum):
    COMPUTED = "COMPUTED"  # at least one zero crossing found
    NO_CROSSING = "NO_CROSSING"  # the signed exposure curve never crosses zero across the scanned grid
    MULTIPLE_CROSSINGS = "MULTIPLE_CROSSINGS"  # more than one crossing -- reported, never silently reduced to one
    INSUFFICIENT_CONTRACTS = "INSUFFICIENT_CONTRACTS"
    SPARSE_CHAIN = "SPARSE_CHAIN"  # fewer usable contracts than a caller-justified minimum
    INVALID_GRID = "INVALID_GRID"


@dataclass(frozen=True)
class GexScanContract:
    strike: float
    years_to_expiry: float
    implied_volatility: Optional[float]
    open_interest: Optional[float]
    option_type: str  # "call" | "put"
    multiplier: int


@dataclass(frozen=True)
class GexSignConvention:
    """A named, caller-justified sign assumption -- never a silent default.
    `verified` must be explicitly set True by a caller who has confirmed
    this matches how the comparison provider's own reported value is
    computed; this module never assumes verification."""

    convention_id: str  # e.g. "CALL_POSITIVE_PUT_NEGATIVE_OI_WEIGHTED"
    call_sign: float  # +1.0 or -1.0
    put_sign: float
    verified: bool


@dataclass(frozen=True)
class GexSpotScanResult:
    state: GexSpotScanState
    sign_convention: GexSignConvention
    scanned_spots: Tuple[float, ...]
    signed_exposure_curve: Tuple[Optional[float], ...]  # None entries mean a spot where too few contracts had usable IV
    zero_crossings: Tuple[float, ...]  # linearly interpolated crossing spot(s); empty unless state==COMPUTED/MULTIPLE_CROSSINGS
    usable_contract_count: int
    excluded_contract_count: int  # missing IV/OI/strike -- never silently treated as zero exposure
    reason: Optional[str]


def _contract_gamma_dollar_exposure(
    contract: GexScanContract, spot: float, convention: GexSignConvention,
) -> Optional[float]:
    if contract.implied_volatility is None or contract.open_interest is None:
        return None
    if contract.implied_volatility <= 0 or contract.open_interest < 0:
        return None
    gamma = bs_gamma(BsInputs(
        spot=spot, strike=contract.strike, years_to_expiry=contract.years_to_expiry,
        risk_free_rate=0.0, sigma=contract.implied_volatility, option_type=contract.option_type,
    ))
    sign = convention.call_sign if contract.option_type == "call" else convention.put_sign
    # Dollar gamma exposure per 1% spot move, matching the standard public
    # convention this module cites from the source repo (gamma * OI *
    # multiplier * spot^2 * 0.01) -- NOT independently re-derived here, cited.
    return sign * gamma * contract.open_interest * contract.multiplier * spot * spot * 0.01


def run_spot_scan(
    contracts: Sequence[GexScanContract],
    spot_grid: Sequence[float],
    sign_convention: GexSignConvention,
    minimum_usable_contracts: int,
) -> GexSpotScanResult:
    """Runs the spot-scan across a CALLER-SUPPLIED grid -- this module never
    invents a grid (band width, step count) on its own; that is a research
    parameter to be justified per use, not hardcoded here. `minimum_usable_
    contracts` is likewise required, guarding against a sparse-chain result
    masquerading as a confident crossing."""
    if len(spot_grid) < 2 or any(value <= 0 for value in spot_grid) or list(spot_grid) != sorted(spot_grid):
        return GexSpotScanResult(
            GexSpotScanState.INVALID_GRID, sign_convention, tuple(spot_grid), (), (), 0, 0,
            "SPOT_GRID_MUST_BE_SORTED_POSITIVE_AND_HAVE_AT_LEAST_TWO_POINTS",
        )
    usable = [contract for contract in contracts if contract.implied_volatility is not None and contract.open_interest is not None]
    excluded = len(contracts) - len(usable)
    if len(usable) < minimum_usable_contracts:
        return GexSpotScanResult(
            GexSpotScanState.SPARSE_CHAIN, sign_convention, tuple(spot_grid), (), (), len(usable), excluded,
            f"USABLE_CONTRACTS_{len(usable)}_BELOW_MINIMUM_{minimum_usable_contracts}",
        )
    if len(usable) == 0:
        return GexSpotScanResult(
            GexSpotScanState.INSUFFICIENT_CONTRACTS, sign_convention, tuple(spot_grid), (), (), 0, excluded,
            "NO_USABLE_CONTRACTS",
        )

    curve: List[Optional[float]] = []
    for spot in spot_grid:
        values = [_contract_gamma_dollar_exposure(contract, spot, sign_convention) for contract in usable]
        known = [value for value in values if value is not None]
        curve.append(sum(known) if known else None)

    crossings: List[float] = []
    for index in range(len(spot_grid) - 1):
        left, right = curve[index], curve[index + 1]
        if left is None or right is None:
            continue
        if left == 0.0:
            crossings.append(spot_grid[index])
            continue
        if (left < 0.0) != (right < 0.0):
            fraction = -left / (right - left)
            crossings.append(spot_grid[index] + fraction * (spot_grid[index + 1] - spot_grid[index]))

    if len(crossings) == 0:
        state = GexSpotScanState.NO_CROSSING
    elif len(crossings) == 1:
        state = GexSpotScanState.COMPUTED
    else:
        state = GexSpotScanState.MULTIPLE_CROSSINGS

    return GexSpotScanResult(
        state, sign_convention, tuple(spot_grid), tuple(curve), tuple(crossings),
        len(usable), excluded,
        None if state != GexSpotScanState.NO_CROSSING else "SIGNED_EXPOSURE_CURVE_DID_NOT_CROSS_ZERO_ON_THIS_GRID",
    )
