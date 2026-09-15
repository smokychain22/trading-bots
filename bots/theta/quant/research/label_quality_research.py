"""Label-quality scoring framework (P2D directive section 11).

Resolved outcome labels from Codex's P2C engine
(`research.theta_resolved_outcome_label`) are not uniformly trustworthy --
a label built from a single PARTIAL, MODELED_RESEARCH observation with a
barely-closed horizon is weaker evidence than one built from many COMPLETE,
BROKER_ACTUAL observations across a fully-observed path. This module scores
that trustworthiness so a future training/evaluation pipeline can WEIGHT or
FILTER labels rather than treating every resolved row as equally strong
evidence -- never inventing a false precision the underlying label doesn't
have.

Every dimension here consumes fields already emitted by Codex's
`resolved-outcome-engine.ts` (`ResolvedOutcomeReceipt`/`OutcomeObservation`)
-- this module adds no new upstream requirement, it only interprets what
already exists. Pure, dependency-free, matching this package's convention.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence


class LabelQualityTier(str, Enum):
    HIGH = "HIGH"  # broker-actual or fully-complete, contract-exact, ample path
    MODERATE = "MODERATE"  # complete but modeled, or partial with good path coverage
    LOW = "LOW"  # partial completeness, sparse path, or a soft ambiguity flag present
    UNUSABLE = "UNUSABLE"  # invalid/unresolved state, or a hard ambiguity flag present


class LabelAmbiguityFlag(str, Enum):
    """Soft flags degrade quality one tier; HARD flags force UNUSABLE
    regardless of everything else -- an event/corporate-action ambiguity
    or an unreconciled contract adjustment makes the label's very
    definition suspect, not merely noisy."""

    EVENT_WINDOW_OVERLAP_SOFT = "EVENT_WINDOW_OVERLAP_SOFT"
    THIN_QUOTE_SOFT = "THIN_QUOTE_SOFT"
    CORPORATE_ACTION_UNRESOLVED_HARD = "CORPORATE_ACTION_UNRESOLVED_HARD"
    CONTRACT_ADJUSTMENT_UNRECONCILED_HARD = "CONTRACT_ADJUSTMENT_UNRECONCILED_HARD"


@dataclass(frozen=True)
class LabelQualityInputs:
    """Mirrors the fields a caller reads directly off a resolved P2C label
    plus its receipt/observations -- every field here has a real source in
    `resolved-outcome-engine.ts`'s own schema, none is invented."""

    resolution_state: str  # 'RESOLVED' | 'PENDING' | 'UNRESOLVED' | 'INVALID'
    completeness: str  # 'COMPLETE' | 'PARTIAL' | 'UNRESOLVED' | 'INVALID'
    provenance: str  # 'BROKER_ACTUAL' | 'MARKET_OBSERVED' | 'REPLAY_OBSERVED' | 'MODELED_RESEARCH' | 'UNRESOLVED' | 'INVALID'
    execution_model_class: str  # 'BROKER_ACTUAL' | 'MARKET_MARK' | 'MODELED_RESEARCH' | 'NONE'
    exact_contract_id_present: bool
    observation_count: int
    observation_count_expected_minimum: int  # caller-justified, e.g. horizon-length / observation-cadence -- never invented here
    horizon_fully_observed: bool  # True only if observations span decision->horizon close with no known gap
    ambiguity_flags: Sequence[LabelAmbiguityFlag] = ()


@dataclass(frozen=True)
class LabelQualityAssessment:
    tier: LabelQualityTier
    reasons: List[str]
    usable_for_training: bool  # False for UNUSABLE; True otherwise -- weighting (not exclusion) is the caller's own downstream choice for LOW/MODERATE


_PROVENANCE_RANK = {"BROKER_ACTUAL": 3, "MARKET_OBSERVED": 2, "REPLAY_OBSERVED": 2, "MODELED_RESEARCH": 1}

_HARD_FLAGS = frozenset({
    LabelAmbiguityFlag.CORPORATE_ACTION_UNRESOLVED_HARD,
    LabelAmbiguityFlag.CONTRACT_ADJUSTMENT_UNRECONCILED_HARD,
})


def assess_label_quality(inputs: LabelQualityInputs) -> LabelQualityAssessment:
    """Never asserts a quality tier the inputs don't support: a state other
    than RESOLVED, or any hard ambiguity flag, is UNUSABLE outright --
    every other dimension only ever DEGRADES the tier from a starting
    point of HIGH, it never upgrades past what completeness/provenance/
    identity/path actually earned."""
    reasons: List[str] = []

    if inputs.resolution_state != "RESOLVED":
        return LabelQualityAssessment(LabelQualityTier.UNUSABLE, [f"RESOLUTION_STATE_{inputs.resolution_state}"], False)

    hard_hits = [flag.value for flag in inputs.ambiguity_flags if flag in _HARD_FLAGS]
    if hard_hits:
        return LabelQualityAssessment(LabelQualityTier.UNUSABLE, hard_hits, False)

    if inputs.completeness == "INVALID" or inputs.completeness == "UNRESOLVED":
        return LabelQualityAssessment(LabelQualityTier.UNUSABLE, [f"COMPLETENESS_{inputs.completeness}"], False)

    tier = LabelQualityTier.HIGH

    if inputs.completeness == "PARTIAL":
        tier = LabelQualityTier.MODERATE
        reasons.append("PARTIAL_COMPLETENESS")

    provenance_rank = _PROVENANCE_RANK.get(inputs.provenance, 0)
    if provenance_rank == 0:
        return LabelQualityAssessment(LabelQualityTier.UNUSABLE, [f"UNRECOGNIZED_PROVENANCE_{inputs.provenance}"], False)
    if provenance_rank == 1:  # MODELED_RESEARCH
        tier = LabelQualityTier.MODERATE if tier == LabelQualityTier.HIGH else LabelQualityTier.LOW
        reasons.append("MODELED_PROVENANCE_NOT_OBSERVED")

    if inputs.provenance == "BROKER_ACTUAL" and inputs.execution_model_class != "BROKER_ACTUAL":
        return LabelQualityAssessment(LabelQualityTier.UNUSABLE, ["BROKER_PROVENANCE_EXECUTION_MODEL_MISMATCH"], False)

    if not inputs.exact_contract_id_present:
        tier = _downgrade(tier)
        reasons.append("NO_EXACT_CONTRACT_IDENTITY")

    if inputs.observation_count < inputs.observation_count_expected_minimum:
        tier = _downgrade(tier)
        reasons.append(f"SPARSE_PATH_{inputs.observation_count}_OF_{inputs.observation_count_expected_minimum}_EXPECTED")

    if not inputs.horizon_fully_observed:
        tier = _downgrade(tier)
        reasons.append("HORIZON_NOT_FULLY_OBSERVED")

    soft_hits = [flag.value for flag in inputs.ambiguity_flags if flag not in _HARD_FLAGS]
    for hit in soft_hits:
        tier = _downgrade(tier)
        reasons.append(hit)

    # Degradation stacking (never a single starting condition) can itself
    # walk the tier down to UNUSABLE -- always re-check, never trust the
    # RESOLVED/COMPLETE early-pass alone to guarantee usability.
    return LabelQualityAssessment(tier, reasons, tier != LabelQualityTier.UNUSABLE)


def _downgrade(tier: LabelQualityTier) -> LabelQualityTier:
    order = [LabelQualityTier.HIGH, LabelQualityTier.MODERATE, LabelQualityTier.LOW, LabelQualityTier.UNUSABLE]
    return order[min(order.index(tier) + 1, len(order) - 1)]


def training_weight_for_tier(tier: LabelQualityTier, weights: dict) -> Optional[float]:
    """`weights` is a REQUIRED, caller-justified mapping from tier to a
    training weight in [0, 1] -- this module never invents a default
    weighting scheme (e.g. "MODERATE = 0.7"). Returns None (never a
    fabricated weight) if the caller's own mapping omits a tier or
    supplies UNUSABLE at all, since UNUSABLE must be excluded, not
    down-weighted."""
    if tier == LabelQualityTier.UNUSABLE:
        return None
    if tier not in weights:
        return None
    value = weights[tier]
    if not isinstance(value, (int, float)) or not (0.0 <= value <= 1.0):
        return None
    return float(value)
