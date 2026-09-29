"""WAIT outcome representation (THETA long-run build, work package 35).

No Python-side WAIT outcome/regret module existed anywhere in this repo
(checked before writing; the TS side has a separate, app-layer
`wait-regret-dataset.ts` this module does not duplicate -- this is the
Claude-owned research-side representation). Keeps three things
structurally separate, by construction (three distinct dataclasses, never
one blended record a caller could accidentally read a future value out of
during a T0 decision):

1. `T0WaitDecision` -- what was known at the WAIT decision moment. No
   future price, no future outcome, no counterfactual assumption is a
   field on this type at all -- it cannot leak by construction.
2. `MaturedWaitOutcome` -- the REAL, later-observed outcome once the
   horizon has actually matured. Only buildable from a real maturation
   timestamp that is strictly after the T0 decision timestamp.
3. `WaitCounterfactualAssumptions` -- explicit, named, separately-labeled
   modeling assumptions (e.g. "if the best-available alternative had been
   taken instead") -- a MODELED_RESEARCH judgment, never confused with the
   REAL_HISTORICAL matured outcome itself.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class T0WaitDecision:
    """The T0 WAIT decision record. Contains NO future information --
    this type structurally cannot carry a future outcome field."""
    underlying_symbol: str
    decision_timestamp: str
    wait_reason_code: str
    best_rejected_candidate_id: Optional[str]
    best_rejected_candidate_utility: Optional[float]  # the T0-known utility of what was passed on, never a future value


@dataclass(frozen=True)
class WaitCounterfactualAssumptions:
    """An explicit, separately-labeled MODELED_RESEARCH judgment about
    what alternative would have been taken -- never silently blended with
    the real matured outcome."""
    assumption_id: str
    assumed_alternative_candidate_id: Optional[str]
    assumption_description: str
    truth_class: str = "MODELED_RESEARCH"


@dataclass(frozen=True)
class MaturedWaitOutcome:
    """The real, later-observed outcome once the horizon has matured.
    Only buildable via `build_matured_wait_outcome`, which enforces
    `maturation_timestamp > decision.decision_timestamp` -- never
    constructible with a maturation moment at or before the T0 decision."""
    underlying_price_at_decision: Optional[float]
    underlying_price_at_maturation: float
    maturation_timestamp: str
    horizon_return: Optional[float]  # None if underlying_price_at_decision was UNKNOWN/zero at T0
    opportunity_cost_vs_best_rejected: Optional[float]  # None if best_rejected_candidate_utility was UNKNOWN at T0
    truth_class: str = "REAL_HISTORICAL"


def build_matured_wait_outcome(
    decision: T0WaitDecision, underlying_price_at_decision: Optional[float],
    underlying_price_at_maturation: float, maturation_timestamp: str,
) -> MaturedWaitOutcome:
    if _parse_iso(maturation_timestamp) <= _parse_iso(decision.decision_timestamp):
        raise ValueError("WAIT_OUTCOME_MATURATION_NOT_AFTER_DECISION_TIME_HINDSIGHT_LEAKAGE")
    horizon_return = (
        None if underlying_price_at_decision is None or underlying_price_at_decision == 0.0
        else (underlying_price_at_maturation / underlying_price_at_decision) - 1.0
    )
    opportunity_cost = (
        None if decision.best_rejected_candidate_utility is None or horizon_return is None
        else decision.best_rejected_candidate_utility - horizon_return
    )
    return MaturedWaitOutcome(
        underlying_price_at_decision=underlying_price_at_decision,
        underlying_price_at_maturation=underlying_price_at_maturation, maturation_timestamp=maturation_timestamp,
        horizon_return=horizon_return, opportunity_cost_vs_best_rejected=opportunity_cost,
    )
