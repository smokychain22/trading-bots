"""Empirical estimator library (THETA long-run build, work package 39).

Every estimator returns the one canonical `EstimatorResult` shape (never a
naked scalar): estimate, N, effective N (reusing
`dataset_readiness.py`'s real, existing `effective_sample_size` --
checked first, not duplicated), confidence interval, method, cohort, time
range, dataset hash, censoring, OOS state. `censored_count` reduces N
before any interval computation -- an open/unmatured episode is never
silently counted as a resolved win or loss.
"""

import math
from dataclasses import dataclass
from typing import Optional, Sequence, Tuple

from research.dataset_readiness import DependenceGroupKey, effective_sample_size


@dataclass(frozen=True)
class EstimatorResult:
    estimate: Optional[float]
    n: int
    effective_n: int
    confidence_interval: Optional[Tuple[float, float]]
    method: str
    cohort: str
    time_range: Tuple[str, str]
    dataset_hash: str
    censored_count: int
    oos_state: str  # "IN_SAMPLE" | "OUT_OF_SAMPLE" | "UNKNOWN"


def _effective_n(dependence_keys: Optional[Sequence[DependenceGroupKey]], n: int) -> int:
    if dependence_keys is None:
        return n
    return effective_sample_size(dependence_keys)


def wilson_interval(
    successes: int, n: int, z: float = 1.959963985, cohort: str = "", time_range: Tuple[str, str] = ("", ""),
    dataset_hash: str = "", censored_count: int = 0, oos_state: str = "UNKNOWN",
    dependence_keys: Optional[Sequence[DependenceGroupKey]] = None,
) -> EstimatorResult:
    """Wilson score interval for a binary win-rate estimator -- never the
    naive normal-approximation interval, which can produce an out-of-[0,1]
    bound at small N (exactly the small-N regime this repo's episodes are
    in). Returns `estimate=None` when N == 0, never a fabricated 0.0 rate.
    """
    if n == 0:
        return EstimatorResult(
            estimate=None, n=0, effective_n=0, confidence_interval=None, method="WILSON_INTERVAL",
            cohort=cohort, time_range=time_range, dataset_hash=dataset_hash, censored_count=censored_count,
            oos_state=oos_state,
        )
    phat = successes / n
    denominator = 1.0 + z * z / n
    center = (phat + z * z / (2 * n)) / denominator
    half_width = (z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))) / denominator
    return EstimatorResult(
        estimate=phat, n=n, effective_n=_effective_n(dependence_keys, n),
        confidence_interval=(max(0.0, center - half_width), min(1.0, center + half_width)),
        method="WILSON_INTERVAL", cohort=cohort, time_range=time_range, dataset_hash=dataset_hash,
        censored_count=censored_count, oos_state=oos_state,
    )


def mean_return_bootstrap(
    returns: Sequence[float], resamples: int = 1000, seed: int = 42, confidence: float = 0.95,
    cohort: str = "", time_range: Tuple[str, str] = ("", ""), dataset_hash: str = "", censored_count: int = 0,
    oos_state: str = "UNKNOWN", dependence_keys: Optional[Sequence[DependenceGroupKey]] = None,
) -> EstimatorResult:
    """Bootstrap CI for the mean of a return sample. Uses a real, recorded
    seed (work package 143's "any stochastic model uses recorded seeds")
    for byte-reproducibility. `estimate=None` for an empty sample."""
    n = len(returns)
    if n == 0:
        return EstimatorResult(
            estimate=None, n=0, effective_n=0, confidence_interval=None, method="MEAN_RETURN_BOOTSTRAP",
            cohort=cohort, time_range=time_range, dataset_hash=dataset_hash, censored_count=censored_count,
            oos_state=oos_state,
        )
    import random
    rng = random.Random(seed)
    means = []
    for _ in range(resamples):
        resample = [returns[rng.randrange(n)] for _ in range(n)]
        means.append(sum(resample) / n)
    means.sort()
    lower_index = int((1 - confidence) / 2 * resamples)
    upper_index = int((1 + confidence) / 2 * resamples) - 1
    upper_index = min(upper_index, resamples - 1)
    return EstimatorResult(
        estimate=sum(returns) / n, n=n, effective_n=_effective_n(dependence_keys, n),
        confidence_interval=(means[lower_index], means[upper_index]), method=f"MEAN_RETURN_BOOTSTRAP_SEED{seed}",
        cohort=cohort, time_range=time_range, dataset_hash=dataset_hash, censored_count=censored_count,
        oos_state=oos_state,
    )


def profit_factor(gross_wins: Sequence[float], gross_losses: Sequence[float]) -> Optional[float]:
    """Sum(wins) / abs(Sum(losses)). `None` when there are no losses at all
    (division undefined, never returned as +infinity or a fabricated
    number)."""
    total_losses = sum(abs(value) for value in gross_losses)
    if total_losses == 0.0:
        return None
    return sum(gross_wins) / total_losses


def avg_win_avg_loss(gross_wins: Sequence[float], gross_losses: Sequence[float]) -> Tuple[Optional[float], Optional[float]]:
    avg_win = sum(gross_wins) / len(gross_wins) if len(gross_wins) > 0 else None
    avg_loss = sum(gross_losses) / len(gross_losses) if len(gross_losses) > 0 else None
    return avg_win, avg_loss


def max_drawdown(equity_curve: Sequence[float]) -> Optional[float]:
    """Fractional max drawdown over a real equity curve. `None` for an
    empty curve or a non-positive starting value (drawdown undefined)."""
    if len(equity_curve) == 0 or equity_curve[0] <= 0.0:
        return None
    peak = equity_curve[0]
    worst = 0.0
    for value in equity_curve:
        peak = max(peak, value)
        worst = max(worst, (peak - value) / peak)
    return worst
