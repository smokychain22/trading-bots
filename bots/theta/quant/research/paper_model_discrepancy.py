"""Paper-vs-model discrepancy metrics (work package 92).

Each function compares a MODELED value (from research code) against a
REAL Paper-observed value (per `paper_analysis_readiness.py`, WP91 --
none exist yet in this repository) and reports the error -- never
computed when the real side is missing (an absent real observation is not
a zero error, it is an unmeasured one).
"""
from __future__ import annotations

from typing import Optional, Sequence
from research.validation import calibration_metrics


def fill_probability_error(modeled_probability: Optional[float], real_filled: Optional[bool]) -> Optional[float]:
    if modeled_probability is None or real_filled is None:
        return None
    return modeled_probability - (1.0 if real_filled else 0.0)


def fill_price_error(modeled_fill_price: Optional[float], real_fill_price: Optional[float]) -> Optional[float]:
    if modeled_fill_price is None or real_fill_price is None:
        return None
    return modeled_fill_price - real_fill_price


def slippage_error(modeled_slippage: Optional[float], real_slippage: Optional[float]) -> Optional[float]:
    if modeled_slippage is None or real_slippage is None:
        return None
    return modeled_slippage - real_slippage


def assignment_error(modeled_assignment_probability: Optional[float], real_assigned: Optional[bool]) -> Optional[float]:
    if modeled_assignment_probability is None or real_assigned is None:
        return None
    return modeled_assignment_probability - (1.0 if real_assigned else 0.0)


def management_rtg_error(modeled_hold_advantage: Optional[float], real_realized_advantage: Optional[float]) -> Optional[float]:
    if modeled_hold_advantage is None or real_realized_advantage is None:
        return None
    return modeled_hold_advantage - real_realized_advantage


def cost_model_error(modeled_total_cost: Optional[float], real_total_cost: Optional[float]) -> Optional[float]:
    if modeled_total_cost is None or real_total_cost is None:
        return None
    return modeled_total_cost - real_total_cost


def fill_probability_calibration_drift(
    modeled_probabilities: Sequence[float], real_filled_labels: Sequence[int], bin_count: int, minimum_n: int,
) -> dict:
    """Reuses validation.py's real calibration_metrics (WP55, unchanged) --
    this is the same calibration report, applied specifically to
    modeled-fill-probability-vs-real-fill-outcome pairs."""
    if len(modeled_probabilities) != len(real_filled_labels):
        raise ValueError('PAPER_MODEL_DISCREPANCY_LENGTH_MISMATCH')
    if len(modeled_probabilities) < minimum_n:
        return {'state': 'INSUFFICIENT_SAMPLE', 'n': len(modeled_probabilities), 'minimumN': minimum_n, 'metrics': None}
    metrics = calibration_metrics(list(modeled_probabilities), list(real_filled_labels), bin_count)
    return {'state': 'EVALUATED', 'n': metrics.sample_size, 'minimumN': minimum_n, 'metrics': metrics}
