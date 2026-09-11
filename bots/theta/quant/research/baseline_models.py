"""Baseline empirical models for THETA's future calibrated-outcome model (R6).

Per the explicit directive: build baselines in increasing complexity
BEFORE any advanced ML, and require any more complex model to beat these
baselines out-of-sample before it earns consideration. Complexity is not
evidence.

Every baseline here operates over an already-resolved episode dataset
(RESOLVED chains only, per `chain_resolution.py` -- CENSORED_OPEN/
INVALID_DATA/EXTERNAL_ACTIVITY_CONTAMINATED chains are never included in
a fit or an evaluation) and produces `None` rather than a number whenever
a bucket has zero observations, never a fabricated 0 or population mean
substituted silently for an empty cell.

No I/O, no provider dependency. Nothing here has been fit against real
data -- there is no real historical dataset yet
(`docs/research/THETA_EV_MODEL_SPEC.md`'s own
EV_MODEL_NOT_EMPIRICALLY_READY status). This module is the machinery
that WOULD fit and evaluate these baselines the moment real, resolved
episodes exist in sufficient number -- it is deliberately exercised only
against synthetic fixtures in its own test suite.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Dict, Hashable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class Episode:
    """One resolved training/evaluation row. `outcome` is the realized
    `Y` (WholeChainPnl or ReturnPerCapitalDay, per
    THETA_EV_MODEL_SPEC.md) for one resolved chain. `features` is an
    arbitrary, caller-defined bag of bucket keys (e.g. {"dte_bucket":
    "15-30", "delta_bucket": "0.20-0.25"}) -- this module never invents a
    feature, it only groups by whatever the caller supplies."""

    chain_id: str
    outcome: float
    features: Dict[str, Hashable]


@dataclass(frozen=True)
class BaselineEstimate:
    """A baseline's point estimate for one bucket (or the whole
    population, for the unconditional baseline). `n` is the RAW episode
    count backing this estimate -- a caller doing walk-forward validation
    is responsible for converting this to an independent/effective N
    per `THETA_WALK_FORWARD_SPEC.md`'s own discipline; this module does
    not conflate the two."""

    mean_outcome: Optional[float]
    stdev_outcome: Optional[float]
    n: int


def unconditional_mean_baseline(episodes: Sequence[Episode]) -> BaselineEstimate:
    """The simplest possible baseline: the population mean of `outcome`
    across every resolved episode, no conditioning at all. Returns
    mean_outcome=None (never 0.0) when there are zero episodes -- an
    empty dataset has no mean, and 0.0 would misleadingly look like a
    genuine "breakeven" finding."""
    if len(episodes) == 0:
        return BaselineEstimate(mean_outcome=None, stdev_outcome=None, n=0)
    outcomes = [e.outcome for e in episodes]
    return BaselineEstimate(
        mean_outcome=mean(outcomes),
        stdev_outcome=pstdev(outcomes) if len(outcomes) > 1 else None,
        n=len(outcomes),
    )


def bucketed_empirical_baseline(
    episodes: Sequence[Episode],
    bucket_key: str,
) -> Dict[Hashable, BaselineEstimate]:
    """Groups episodes by `episode.features[bucket_key]` (e.g. DTE
    bucket, delta bucket, IV regime, market regime, ownership bucket --
    the exact bucket dimensions item 7's baseline-complexity ladder
    names) and computes the unconditional-mean baseline WITHIN each
    group independently. A bucket value that appears in zero episodes is
    simply absent from the returned dict -- never synthesized with a
    fabricated estimate borrowed from the overall population."""
    groups: Dict[Hashable, List[Episode]] = {}
    for episode in episodes:
        if bucket_key not in episode.features:
            continue  # an episode missing this specific feature contributes to no bucket -- never guessed into one
        groups.setdefault(episode.features[bucket_key], []).append(episode)
    return {bucket: unconditional_mean_baseline(group) for bucket, group in groups.items()}


def cross_bucketed_empirical_baseline(
    episodes: Sequence[Episode],
    bucket_keys: Sequence[str],
) -> Dict[Tuple[Hashable, ...], BaselineEstimate]:
    """As `bucketed_empirical_baseline`, but grouping on the FULL cross
    of multiple bucket dimensions at once (e.g. DTE bucket x delta
    bucket x regime) -- per item 3 of the walk-forward stratified-
    reporting requirement, since a model's OOS performance must be
    checked per-cohort, not just per single dimension. An episode
    missing ANY of the requested keys contributes to no cross-bucket."""
    groups: Dict[Tuple[Hashable, ...], List[Episode]] = {}
    for episode in episodes:
        if not all(key in episode.features for key in bucket_keys):
            continue
        cross_key = tuple(episode.features[key] for key in bucket_keys)
        groups.setdefault(cross_key, []).append(episode)
    return {bucket: unconditional_mean_baseline(group) for bucket, group in groups.items()}


@dataclass(frozen=True)
class RegularizedLinearModel:
    """A minimal, dependency-free ridge-regularized linear model —
    intentionally the next rung up from the bucketed-empirical
    baselines, per item 7's explicit ladder ("regularized linear model"
    before "calibrated logistic," before any tree/boosting model, before
    any advanced sequence/generative model). Fit via closed-form ridge
    (X^T X + lambda*I)^-1 X^T y over a small, dense feature matrix --
    intentionally not a general-purpose ML library dependency, since
    THETA's own architecture already avoids adding a new dependency
    without a documented missing capability, and this baseline's whole
    purpose is to be the simplest possible next step, not a production
    ML stack.
    """

    weights: Tuple[float, ...]
    feature_names: Tuple[str, ...]
    intercept: float


def fit_regularized_linear_baseline(
    episodes: Sequence[Episode],
    feature_names: Sequence[str],
    ridge_lambda: float = 1.0,
) -> Optional[RegularizedLinearModel]:
    """Fits `outcome ~ intercept + sum(w_i * feature_i)` via closed-form
    ridge regression. Returns None (never a degenerate/garbage fit) when
    there are fewer episodes than features + 1, or when any requested
    feature is missing from an episode (that episode is excluded, never
    imputed with a guessed value) leaves too few rows to fit.
    """
    rows: List[List[float]] = []
    targets: List[float] = []
    for episode in episodes:
        if not all(name in episode.features for name in feature_names):
            continue
        try:
            row = [float(episode.features[name]) for name in feature_names]  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue  # a non-numeric feature value for this episode -- excluded, never coerced
        rows.append(row)
        targets.append(episode.outcome)

    p = len(feature_names)
    if len(rows) < p + 1:
        return None

    # Closed-form ridge via pure-Python Gaussian elimination (no numpy
    # dependency) -- adequate for the small feature counts this baseline
    # ladder is meant for; a real production fit would use a validated
    # numerical library, but that decision is deferred until this
    # baseline actually needs to run against real data.
    n = len(rows)
    design = [[1.0] + row for row in rows]  # intercept column first
    dim = p + 1

    xtx = [[sum(design[k][i] * design[k][j] for k in range(n)) for j in range(dim)] for i in range(dim)]
    for i in range(dim):
        xtx[i][i] += ridge_lambda if i > 0 else 0.0  # never regularize the intercept term
    xty = [sum(design[k][i] * targets[k] for k in range(n)) for i in range(dim)]

    solution = _solve_linear_system(xtx, xty)
    if solution is None:
        return None
    return RegularizedLinearModel(intercept=solution[0], weights=tuple(solution[1:]), feature_names=tuple(feature_names))


def predict_regularized_linear_baseline(model: RegularizedLinearModel, features: Dict[str, Hashable]) -> Optional[float]:
    """Returns None (never a guessed prediction) if any feature the model
    was fit on is missing from this specific prediction's inputs."""
    try:
        values = [float(features[name]) for name in model.feature_names]  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError):
        return None
    return model.intercept + sum(w * v for w, v in zip(model.weights, values))


def _solve_linear_system(matrix: List[List[float]], vector: List[float]) -> Optional[List[float]]:
    """Gaussian elimination with partial pivoting. Returns None
    (singular/near-singular system) rather than raising or returning a
    numerically garbage result."""
    n = len(vector)
    augmented = [row[:] + [vector[i]] for i, row in enumerate(matrix)]

    for col in range(n):
        pivot_row = max(range(col, n), key=lambda r: abs(augmented[r][col]))
        if abs(augmented[pivot_row][col]) < 1e-12:
            return None
        augmented[col], augmented[pivot_row] = augmented[pivot_row], augmented[col]
        pivot_value = augmented[col][col]
        augmented[col] = [x / pivot_value for x in augmented[col]]
        for r in range(n):
            if r == col:
                continue
            factor = augmented[r][col]
            augmented[r] = [a - factor * b for a, b in zip(augmented[r], augmented[col])]

    return [augmented[i][n] for i in range(n)]
