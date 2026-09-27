"""Graduation metric engine (work package 93).

Assembles the full graduation metric set into one report shape. Every
metric except Expected Shortfall / CVaR already has a real, independently
tested producer elsewhere in this repo -- this engine does not
reimplement after-cost EV (`after_cost_ev_identifiability.py`), PF/
AvgWin/AvgLoss/drawdown/effective-N (`empirical_estimators.py`),
calibration (`validation.py`), capital-days (`management_accounting_fixtures.py`),
recovery (`models/recovery_spec.py`), or execution quality
(`models/execution_quality.py`) -- callers compute those with their own
real functions and pass the results in. `expected_shortfall` (ES/CVaR)
had no producer anywhere in this repo; it is implemented here, the one
genuinely new piece.

No live authorization is granted or implied by this report -- it is
evidence assembly only, exactly like `promotion_evidence_assembler.py`
(WP89, unchanged), which this engine's output is meant to feed.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

GRADUATION_METRIC_KEYS = (
    'afterCostEv', 'profitFactor', 'avgWin', 'avgLoss', 'maxDrawdown', 'expectedShortfall', 'effectiveN',
    'calibration', 'capitalDays', 'assignment', 'recovery', 'executionQuality', 'paperSimDiscrepancy',
)


def expected_shortfall(losses: Sequence[float], quantile: float) -> Optional[float]:
    """The mean of the worst `quantile` fraction of a loss sample (losses
    as positive numbers, larger = worse). `None` for an empty sample or an
    invalid quantile -- never a fabricated tail estimate from too few
    observations to define one."""
    if not (0 < quantile < 1):
        raise ValueError('EXPECTED_SHORTFALL_QUANTILE_INVALID')
    if not losses:
        return None
    ordered = sorted(losses, reverse=True)
    tail_count = max(1, round(len(ordered) * quantile))
    tail = ordered[:tail_count]
    return sum(tail) / len(tail)


def assemble_graduation_metrics(sub_metrics: Dict[str, Any]) -> dict:
    missing = [key for key in GRADUATION_METRIC_KEYS if key not in sub_metrics]
    payload = {
        'version': 'theta-graduation-metric-engine-v1',
        'metrics': {key: sub_metrics.get(key) for key in GRADUATION_METRIC_KEYS},
        'missingMetrics': missing, 'state': 'COMPLETE' if not missing else 'PARTIAL',
        'liveAuthorization': 'NOT_GRANTED',
    }
    return payload
