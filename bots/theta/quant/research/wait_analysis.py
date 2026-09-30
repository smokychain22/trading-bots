"""Matured WAIT comparison: avoided loss vs. missed opportunity vs.
unidentifiable counterfactual (work package 77).

Composes over `wait_outcome.py`'s existing `MaturedWaitOutcome` (WP35,
unchanged) rather than re-deriving its opportunity-cost arithmetic. That
module already enforces `maturation_timestamp > decision_timestamp`
(no hindsight leakage) and keeps T0 fields structurally free of future
information -- this module only classifies the already-computed,
already-PIT-safe `opportunity_cost_vs_best_rejected` into one of three
named outcomes, never re-touching T0.
"""
from __future__ import annotations

from enum import Enum
from math import isfinite
from research.wait_outcome import MaturedWaitOutcome


class WaitRegretClassification(str, Enum):
    AVOIDED_LOSS = 'AVOIDED_LOSS'  # the rejected alternative would have done worse than waiting
    MISSED_OPPORTUNITY = 'MISSED_OPPORTUNITY'  # the rejected alternative would have done better than waiting
    UNIDENTIFIABLE_COUNTERFACTUAL = 'UNIDENTIFIABLE_COUNTERFACTUAL'  # opportunity cost not computable from what was known
    EQUAL_RETURN = 'EQUAL_RETURN'


def classify_wait_regret(outcome: MaturedWaitOutcome) -> WaitRegretClassification:
    cost = outcome.opportunity_cost_vs_best_rejected
    if cost is None:
        return WaitRegretClassification.UNIDENTIFIABLE_COUNTERFACTUAL
    if not isfinite(cost):
        raise ValueError('WAIT_REGRET_NONFINITE_COMPARISON')
    if cost == 0:
        return WaitRegretClassification.EQUAL_RETURN
    if cost > 0:
        return WaitRegretClassification.MISSED_OPPORTUNITY
    return WaitRegretClassification.AVOIDED_LOSS
