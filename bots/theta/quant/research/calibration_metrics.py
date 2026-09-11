"""Probability calibration metrics for THETA's future calibrated models (R6).

Applies to any probability THETA eventually models empirically -- P(win),
P(assignment), P(severe drawdown) -- per the explicit directive. Every
metric here operates on ALREADY-COMPUTED (predicted_probability,
realized_outcome) pairs from resolved episodes; nothing here fits a
model or invents a probability.

The standing rule this module exists to make checkable, not just stated:
delta or a Black-Scholes N(d2) is NEVER a substitute for an empirically
calibrated win probability (the GitHub corpus's own
`ksanjay/Kelly-Criterion-Option-Selector` negative example, cataloged in
`docs/research/THETA_FORMULA_CATALOG.md`). A "probability" that has never
been run through calibration diagnostics is not a calibrated probability
regardless of the model that produced it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Sequence


@dataclass(frozen=True)
class CalibrationPair:
    predicted_probability: float  # in [0, 1]
    realized_outcome: bool  # True = the event occurred (e.g. the episode was profitable)


def brier_score(pairs: Sequence[CalibrationPair]) -> Optional[float]:
    """Brier score: mean squared error between predicted probability and
    the realized (0/1) outcome. Lower is better; 0 is perfect, 0.25 is
    what an uninformative p=0.5 model scores against a 50/50 outcome
    rate. Returns None for an empty input -- never a fabricated 0.0
    (which would misleadingly look like perfect calibration)."""
    if len(pairs) == 0:
        return None
    total = sum((pair.predicted_probability - (1.0 if pair.realized_outcome else 0.0)) ** 2 for pair in pairs)
    return total / len(pairs)


def log_loss(pairs: Sequence[CalibrationPair], epsilon: float = 1e-12) -> Optional[float]:
    """Binary cross-entropy / log loss. `epsilon` clips predicted
    probabilities away from exactly 0 or 1 (which would otherwise produce
    -inf for a single misclassified case) -- this is a numerical-safety
    clip, not a calibration correction, and is applied symmetrically.
    Returns None for empty input."""
    if len(pairs) == 0:
        return None
    total = 0.0
    for pair in pairs:
        p = min(max(pair.predicted_probability, epsilon), 1.0 - epsilon)
        total += -(math.log(p) if pair.realized_outcome else math.log(1.0 - p))
    return total / len(pairs)


@dataclass(frozen=True)
class ReliabilityBucket:
    bucket_lower: float
    bucket_upper: float
    mean_predicted_probability: Optional[float]
    empirical_frequency: Optional[float]
    n: int


def reliability_diagram(
    pairs: Sequence[CalibrationPair],
    n_buckets: int = 10,
) -> List[ReliabilityBucket]:
    """Buckets predictions into `n_buckets` equal-width probability bins
    and reports, per bucket, the mean predicted probability versus the
    empirical realized-outcome frequency -- a well-calibrated model has
    these two numbers close together in every bucket, not just on
    average. A bucket with zero predictions reports both as None (never
    a fabricated 0.0 or borrowed from a neighboring bucket)."""
    if n_buckets <= 0:
        raise ValueError("n_buckets must be positive")

    width = 1.0 / n_buckets
    buckets: List[List[CalibrationPair]] = [[] for _ in range(n_buckets)]
    for pair in pairs:
        # A tiny epsilon guards against float division putting an exact
        # bucket-boundary probability (e.g. 0.7 with 10 buckets) one
        # bucket lower than intended due to floating-point imprecision
        # (0.7 / 0.1 can evaluate to 6.999999999999999, not 7.0).
        # Clamp p=1.0 into the last bucket rather than an out-of-range index.
        index = min(int(pair.predicted_probability / width + 1e-9), n_buckets - 1)
        buckets[index].append(pair)

    results: List[ReliabilityBucket] = []
    for i, bucket_pairs in enumerate(buckets):
        lower, upper = i * width, (i + 1) * width
        if len(bucket_pairs) == 0:
            results.append(ReliabilityBucket(lower, upper, None, None, 0))
            continue
        mean_p = sum(p.predicted_probability for p in bucket_pairs) / len(bucket_pairs)
        freq = sum(1 for p in bucket_pairs if p.realized_outcome) / len(bucket_pairs)
        results.append(ReliabilityBucket(lower, upper, mean_p, freq, len(bucket_pairs)))
    return results


def expected_calibration_error(pairs: Sequence[CalibrationPair], n_buckets: int = 10) -> Optional[float]:
    """ECE: the weighted-by-bucket-size average absolute gap between mean
    predicted probability and empirical frequency across the reliability
    diagram's buckets. Returns None for empty input. Empty buckets
    contribute zero weight (never a fabricated gap of 0, which would bias
    ECE downward if many buckets happen to be empty in a small sample)."""
    if len(pairs) == 0:
        return None
    buckets = reliability_diagram(pairs, n_buckets)
    total_n = sum(b.n for b in buckets)
    if total_n == 0:
        return None
    weighted_gap = sum(
        b.n * abs((b.mean_predicted_probability or 0.0) - (b.empirical_frequency or 0.0))
        for b in buckets if b.n > 0
    )
    return weighted_gap / total_n


def calibration_drift(
    baseline_pairs: Sequence[CalibrationPair],
    recent_pairs: Sequence[CalibrationPair],
    n_buckets: int = 10,
) -> Optional[float]:
    """Compares ECE between an earlier baseline window and a more recent
    window of the SAME model's predictions -- a rising ECE over time
    signals calibration drift (the model's probabilities are becoming
    less trustworthy, e.g. due to a regime shift) even if the model was
    never refit. Returns the recent-minus-baseline ECE delta; None if
    either window is empty (never a fabricated "no drift" of 0.0)."""
    baseline_ece = expected_calibration_error(baseline_pairs, n_buckets)
    recent_ece = expected_calibration_error(recent_pairs, n_buckets)
    if baseline_ece is None or recent_ece is None:
        return None
    return recent_ece - baseline_ece
