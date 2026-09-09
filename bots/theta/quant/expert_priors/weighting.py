"""Expert evidence-weight framework (TRD v1.1 FINAL section 48, EXPMATH-001/002).

    RawExpertWeight_e = DataQuality_e * SampleConfidence_e * RegimeFit_e
                        * Recency_e * Independence_e * Transferability_e
    ShrunkWeight_e     = RawExpertWeight_e * N_e / (N_e + k_shrink)
    ExpertPrior(a|X)   = sum_e ShrunkWeight_e * P_e(a|X) / sum_e ShrunkWeight_e

Pure functions only -- no file I/O, no network, no defaults invented for
values the TRD leaves as versioned research parameters. In particular
``k_shrink`` has no hard-coded default here: TRD frames it as a shrinkage
constant that belongs to a versioned strategy/feature configuration, not a
constant baked into code. Callers must supply it explicitly.
"""

from dataclasses import dataclass
from typing import Mapping, Optional, Sequence


@dataclass(frozen=True)
class ExpertWeightFactors:
    """The six EXPMATH-001 factors for one expert, each expected on a
    reliability scale where 0 means 'no reliability' and higher is stronger.
    This module does not clamp them to [0, 1] -- TRD does not specify an
    upper bound for these factors, only that they are reliability-weighted
    (EXP-001) -- but it does reject negative values, since a negative
    reliability weight has no defined meaning.
    """

    data_quality: float
    sample_confidence: float
    regime_fit: float
    recency: float
    independence: float
    transferability: float

    def __post_init__(self) -> None:
        for name, value in (
            ("data_quality", self.data_quality),
            ("sample_confidence", self.sample_confidence),
            ("regime_fit", self.regime_fit),
            ("recency", self.recency),
            ("independence", self.independence),
            ("transferability", self.transferability),
        ):
            if value < 0:
                raise ValueError(f"{name} must be >= 0, got {value!r}")


def raw_expert_weight(factors: ExpertWeightFactors) -> float:
    """RawExpertWeight_e -- the product of the six EXPMATH-001 factors."""
    return (
        factors.data_quality
        * factors.sample_confidence
        * factors.regime_fit
        * factors.recency
        * factors.independence
        * factors.transferability
    )


def shrunk_weight(raw_weight: float, n: float, k_shrink: float) -> float:
    """ShrunkWeight_e -- small/high-reliability-looking samples cannot
    dominate the policy merely because ``raw_weight`` is high (EXPMATH-001).

    ``k_shrink`` must be supplied by the caller from a versioned
    strategy/feature configuration -- there is no built-in default, per
    TRD's own instruction that risk/strategy parameters are versioned
    configuration, not constants embedded in code (TRD section 51).
    """
    if raw_weight < 0:
        raise ValueError(f"raw_weight must be >= 0, got {raw_weight!r}")
    if n < 0:
        raise ValueError(f"n must be >= 0, got {n!r}")
    if k_shrink <= 0:
        raise ValueError(f"k_shrink must be > 0, got {k_shrink!r}")
    return raw_weight * n / (n + k_shrink)


@dataclass(frozen=True)
class WeightedExpertOpinion:
    """One expert's shrunk weight and their opinion P_e(a|X) for a single
    candidate action `a` under state `X`. `p_action` is intentionally
    ``Optional[float]`` -- an expert with UNKNOWN evidence for this specific
    action must be represented as ``None``, never coerced to 0.0, per the
    UNKNOWN-is-not-zero rule that applies everywhere else in THETA.
    """

    expert_source_id: str
    shrunk_weight: float
    p_action: Optional[float]


def expert_prior(opinions: Sequence[WeightedExpertOpinion]) -> Optional[float]:
    """ExpertPrior(a|X) -- the shrinkage-weighted blend of expert opinions
    for one candidate action. Returns ``None`` (UNKNOWN) rather than 0.0 when
    there is no usable evidence at all, so a caller cannot mistake "no
    evidence" for "zero-probability action" (EXPMATH-002 discipline extended
    to the aggregation step, not just the raw inputs).
    """
    usable = [o for o in opinions if o.p_action is not None and o.shrunk_weight > 0]
    total_weight = sum(o.shrunk_weight for o in usable)
    if total_weight <= 0:
        return None
    return sum(o.shrunk_weight * o.p_action for o in usable) / total_weight


def expert_prior_by_action(
    per_action_opinions: Mapping[str, Sequence[WeightedExpertOpinion]],
) -> Mapping[str, Optional[float]]:
    """Convenience wrapper: compute :func:`expert_prior` for each candidate
    action in a mapping of action -> opinions, preserving ``None`` for any
    action with no usable evidence rather than dropping it silently.
    """
    return {action: expert_prior(opinions) for action, opinions in per_action_opinions.items()}
