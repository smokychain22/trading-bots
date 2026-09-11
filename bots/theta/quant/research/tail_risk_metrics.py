"""Tail-risk distribution metrics for THETA's Full-H economics (R6).

Full-H needs more than E[PnL] -- per the explicit directive, this module
computes the distributional quantities that let candidate comparison
distinguish "high mean, catastrophic tail" from "slightly lower mean,
materially better risk-adjusted economics": P(PnL > 0), quantiles, VaR,
Expected Shortfall, alongside the mean.

FROZEN CONVENTION (never mixed with any other sign/direction convention
anywhere in THETA's codebase):

    Loss = -PnL
    VaR_alpha  = the alpha-quantile of the LOSS distribution
                 (e.g. VaR_0.95 is the loss level exceeded only 5% of the time)
    ES_alpha   = E[Loss | Loss >= VaR_alpha]
                 (the average loss in exactly that worst alpha-tail)

`alpha` is always stated explicitly at every call site and every
reported result -- never an implicit default a caller could silently
disagree about. A profit-tail metric (e.g. "expected upside in the best
5%") is a DIFFERENT, separately-named quantity
(`expected_upside_in_best_tail`) -- it is never computed by negating a
loss-tail formula or otherwise silently blended with the loss-tail
convention above.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence


def _quantile(sorted_values: Sequence[float], alpha: float) -> float:
    """Linear-interpolation quantile (the same convention `numpy.quantile`
    uses by default) over an already-sorted sequence. `alpha` in [0, 1]."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = alpha * (len(sorted_values) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    fraction = position - lower_index
    return sorted_values[lower_index] + fraction * (sorted_values[upper_index] - sorted_values[lower_index])


@dataclass(frozen=True)
class TailRiskSummary:
    n: int
    mean_pnl: Optional[float]
    probability_profitable: Optional[float]  # P(PnL > 0)
    alpha: float
    value_at_risk: Optional[float]  # VaR_alpha, on the Loss = -PnL convention (a positive number = a real loss)
    expected_shortfall: Optional[float]  # ES_alpha, same convention
    pnl_quantiles: dict  # {quantile_label: pnl_value}, e.g. {"p05": ..., "p50": ..., "p95": ...}


def compute_tail_risk_summary(
    pnl_observations: Sequence[float],
    alpha: float = 0.95,
    quantile_labels: Optional[dict] = None,
) -> TailRiskSummary:
    """Computes the full tail-risk summary over a sample of RESOLVED
    episode P&L observations (never an open/censored chain's placeholder
    value -- the caller is responsible for having already excluded those
    via `chain_resolution.py`). `quantile_labels` maps a label to the
    quantile fraction to report, e.g. {"p05": 0.05, "p50": 0.5, "p95":
    0.95} (defaults to that same set if omitted).

    Every field is None (never a fabricated number) when there are zero
    observations. `alpha` must be in (0, 1) -- validated, never silently
    clamped.
    """
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")

    n = len(pnl_observations)
    if n == 0:
        return TailRiskSummary(n=0, mean_pnl=None, probability_profitable=None, alpha=alpha, value_at_risk=None, expected_shortfall=None, pnl_quantiles={})

    if quantile_labels is None:
        quantile_labels = {"p05": 0.05, "p25": 0.25, "p50": 0.5, "p75": 0.75, "p95": 0.95}

    sorted_pnl = sorted(pnl_observations)
    losses = sorted([-pnl for pnl in pnl_observations])  # Loss = -PnL, frozen convention

    mean_pnl = sum(pnl_observations) / n
    probability_profitable = sum(1 for pnl in pnl_observations if pnl > 0) / n

    value_at_risk = _quantile(losses, alpha)
    tail_losses = [loss for loss in losses if loss >= value_at_risk]
    # tail_losses is always non-empty: value_at_risk is itself a member
    # of `losses` (or interpolated between two adjacent members), so at
    # least the largest loss(es) at or above it are always included.
    expected_shortfall = sum(tail_losses) / len(tail_losses)

    pnl_quantiles = {label: _quantile(sorted_pnl, q) for label, q in quantile_labels.items()}

    return TailRiskSummary(
        n=n, mean_pnl=mean_pnl, probability_profitable=probability_profitable, alpha=alpha,
        value_at_risk=value_at_risk, expected_shortfall=expected_shortfall, pnl_quantiles=pnl_quantiles,
    )


def expected_upside_in_best_tail(pnl_observations: Sequence[float], alpha: float = 0.95) -> Optional[float]:
    """A DISTINCT, separately-named profit-tail metric -- the average
    PnL among the best (1-alpha) fraction of outcomes. Never computed by
    negating `expected_shortfall`'s loss-tail formula, and never reported
    under the ES/VaR names, to keep the loss-tail and profit-tail
    conventions from ever being silently blended together."""
    n = len(pnl_observations)
    if n == 0:
        return None
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")
    sorted_pnl = sorted(pnl_observations)
    threshold = _quantile(sorted_pnl, alpha)
    best_tail = [pnl for pnl in sorted_pnl if pnl >= threshold]
    return sum(best_tail) / len(best_tail)
