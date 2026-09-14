"""Gamma-regime research classifier (R6 item 24: "gamma regime" hypothesis).

Matches `models/regime_v0.py`'s exact discipline: a simple, interpretable,
rule-based baseline BEFORE any latent-state model, versioned/required
thresholds (no invented default), UNKNOWN preserved as its own state, and
reason codes for every classification. This module is a CHALLENGER input
to the standing regime axes, not a replacement for `regime_v0.classify`'s
five orthogonal axes -- `models/regime_v0.py` itself documents that a
future challenger "would replace ONE axis at a time... only if it beats
this rule-based v0 on untouched-OOS economic value," and this module is
built to be tested exactly that way against `VolatilityState`, never
substituted in without OOS evidence.

Critical discipline this module enforces structurally: Optionomics' own
GEX/gamma-flip sign and magnitude CONVENTION is unverified (confirmed
directly in `optionomics_context_metrics.UNVERIFIED_SIGN_CONVENTION_
FIELDS` and Codex's own `optionomics-provider.ts` comments). This module
therefore NEVER asserts "positive GEX means the dealer book is long
gamma" or any directional market claim -- it classifies the OBSERVED
sign/magnitude/distance into a labeled state and carries the unverified-
convention caveat through every result, exactly like the standing
"reject GEX-sign-implies-direction" invariant this repository enforces
elsewhere (`docs/research/THETA_QUANTWHEEL_TEARDOWN.md`).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

from models.common import ReasonCode


class GexSignState(str, Enum):
    """The OBSERVED sign of the provider's own reported total GEX value --
    never interpreted as a directional forecast. `POSITIVE`/`NEGATIVE`
    describe the number Optionomics returned, under its own unverified
    convention, nothing more."""

    POSITIVE_REPORTED = "POSITIVE_REPORTED"
    NEGATIVE_REPORTED = "NEGATIVE_REPORTED"
    ZERO_REPORTED = "ZERO_REPORTED"


class GammaFlipProximityState(str, Enum):
    NEAR = "NEAR"
    FAR = "FAR"


@dataclass(frozen=True)
class GammaRegimePolicyV0:
    """Versioned thresholds -- required, not defaulted, per the standing
    no-invented-threshold discipline."""

    policy_version: str
    flip_proximity_pct_of_spot_ceiling: float  # |spot - flip| / spot <= this is NEAR


@dataclass(frozen=True)
class GammaRegimeInputs:
    """Every field Optional -- a caller with an unresolved Optionomics
    METRICS observation supplies None, never a guessed number.
    `total_gex` and `gamma_flip_strike` come from `optionomics_context_
    metrics.OptionomicsMetricsSnapshot` (the CONFIRMED field mapping),
    never a guessed key."""

    total_gex: Optional[float]
    gamma_flip_strike: Optional[float]
    spot_price: Optional[float]
    sign_convention_verified: bool  # must be explicitly True to trust total_gex's sign at all


@dataclass(frozen=True)
class GammaRegimeSnapshot:
    gex_sign_state: Optional[GexSignState]
    flip_proximity_state: Optional[GammaFlipProximityState]
    flip_distance_pct_of_spot: Optional[float]
    sign_convention_caveat: str
    confidence: float  # fraction of the two axes resolvable
    reasons: List[ReasonCode]


_UNVERIFIED_CAVEAT = (
    "Optionomics' own GEX sign/magnitude convention is unverified "
    "(documented, not observed as an authenticated contract) -- this "
    "state describes the reported number only, never a directional claim."
)


def _gex_sign_state(inputs: GammaRegimeInputs) -> tuple:
    if inputs.total_gex is None:
        return None, ReasonCode("GEX_SIGN_UNKNOWN", -1, "total_gex is UNKNOWN.")
    if not inputs.sign_convention_verified:
        return None, ReasonCode(
            "GEX_SIGN_CONVENTION_UNVERIFIED", -1,
            "total_gex is present but its sign convention has not been verified -- refusing to classify a sign that may not mean what it appears to.",
        )
    if inputs.total_gex > 0:
        return GexSignState.POSITIVE_REPORTED, ReasonCode("GEX_POSITIVE_REPORTED", 0, f"total_gex={inputs.total_gex} > 0 as reported")
    if inputs.total_gex < 0:
        return GexSignState.NEGATIVE_REPORTED, ReasonCode("GEX_NEGATIVE_REPORTED", 0, f"total_gex={inputs.total_gex} < 0 as reported")
    return GexSignState.ZERO_REPORTED, ReasonCode("GEX_ZERO_REPORTED", 0, "total_gex=0 as reported")


def _flip_proximity_state(inputs: GammaRegimeInputs, policy: GammaRegimePolicyV0) -> tuple:
    if inputs.gamma_flip_strike is None or inputs.spot_price is None:
        return None, None, ReasonCode("GAMMA_FLIP_PROXIMITY_UNKNOWN", -1, "gamma_flip_strike or spot_price is UNKNOWN.")
    if inputs.spot_price <= 0:
        return None, None, ReasonCode("GAMMA_FLIP_PROXIMITY_INVALID", -1, "spot_price must be > 0.")
    distance_pct = abs(inputs.spot_price - inputs.gamma_flip_strike) / inputs.spot_price
    if distance_pct <= policy.flip_proximity_pct_of_spot_ceiling:
        return GammaFlipProximityState.NEAR, distance_pct, ReasonCode(
            "GAMMA_FLIP_NEAR", 0, f"distance_pct={distance_pct:.4f} <= ceiling {policy.flip_proximity_pct_of_spot_ceiling}",
        )
    return GammaFlipProximityState.FAR, distance_pct, ReasonCode(
        "GAMMA_FLIP_FAR", 0, f"distance_pct={distance_pct:.4f} > ceiling {policy.flip_proximity_pct_of_spot_ceiling}",
    )


def classify(inputs: GammaRegimeInputs, policy: GammaRegimePolicyV0) -> GammaRegimeSnapshot:
    gex_sign, gex_reason = _gex_sign_state(inputs)
    flip_proximity, flip_distance_pct, flip_reason = _flip_proximity_state(inputs, policy)

    axes = [gex_sign, flip_proximity]
    confidence = sum(1 for axis in axes if axis is not None) / len(axes)

    return GammaRegimeSnapshot(
        gex_sign_state=gex_sign, flip_proximity_state=flip_proximity,
        flip_distance_pct_of_spot=flip_distance_pct, sign_convention_caveat=_UNVERIFIED_CAVEAT,
        confidence=confidence, reasons=[gex_reason, flip_reason],
    )
