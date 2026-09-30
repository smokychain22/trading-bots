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
from math import isfinite
from typing import Optional


def _parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError('WAIT_TIMESTAMP_TIMEZONE_REQUIRED')
    return parsed


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
    opportunity_cost_vs_best_rejected: Optional[float]  # Same-capital, same-horizon return difference, not T0 utility minus stock return.
    truth_class: str = "UNKNOWN"
    counterfactual_truth_class: str = "UNKNOWN"
    counterfactual_evidence_id: Optional[str] = None


def build_matured_wait_outcome(
    decision: T0WaitDecision, underlying_price_at_decision: Optional[float],
    underlying_price_at_maturation: float, maturation_timestamp: str,
    alternative: Optional[dict] = None,
    observation_truth_class: str = 'UNKNOWN',
) -> MaturedWaitOutcome:
    if observation_truth_class not in ('MARKET_OBSERVED', 'MODELED_RESEARCH', 'SYNTHETIC_TEST', 'UNKNOWN'):
        raise ValueError('WAIT_OBSERVATION_TRUTH_INVALID')
    if _parse_iso(maturation_timestamp) <= _parse_iso(decision.decision_timestamp):
        raise ValueError("WAIT_OUTCOME_MATURATION_NOT_AFTER_DECISION_TIME_HINDSIGHT_LEAKAGE")
    for price in (underlying_price_at_decision, underlying_price_at_maturation):
        if price is not None and (type(price) not in (float, int) or not isfinite(price) or price <= 0):
            raise ValueError('WAIT_PRICE_INVALID')
    if underlying_price_at_maturation is None:
        raise ValueError('WAIT_MATURATION_PRICE_REQUIRED')
    horizon_return = (
        None if underlying_price_at_decision is None or underlying_price_at_decision == 0.0
        else (underlying_price_at_maturation / underlying_price_at_decision) - 1.0
    )
    opportunity_cost, truth, evidence_id = None, 'UNKNOWN', None
    if alternative is not None:
        if alternative.get('candidateId') != decision.best_rejected_candidate_id or not decision.best_rejected_candidate_id:
            raise ValueError('WAIT_ALTERNATIVE_IDENTITY_MISMATCH')
        if not alternative.get('evidenceId') or not alternative.get('costModelVersion') or alternative.get('units') != 'AFTER_COST_RETURN_FRACTION_ON_SAME_CAPITAL':
            raise ValueError('WAIT_ALTERNATIVE_PROVENANCE_OR_UNITS_INVALID')
        if (_parse_iso(alternative['horizonStart']) != _parse_iso(decision.decision_timestamp) or
                _parse_iso(alternative['horizonEnd']) != _parse_iso(maturation_timestamp) or
                _parse_iso(alternative['labelAvailableAt']) < _parse_iso(maturation_timestamp)):
            raise ValueError('WAIT_ALTERNATIVE_HORIZON_INVALID')
        truth = alternative.get('truthClass')
        if truth not in ('MARKET_OBSERVED_COUNTERFACTUAL', 'MODELED_COUNTERFACTUAL', 'SYNTHETIC_TEST'):
            raise ValueError('WAIT_ALTERNATIVE_TRUTH_INVALID')
        values = [alternative.get('alternativeReturn'), alternative.get('waitReturn')]
        if any(type(v) not in (float, int) or not isfinite(v) for v in values):
            raise ValueError('WAIT_ALTERNATIVE_RETURN_INVALID')
        opportunity_cost = values[0] - values[1]
        evidence_id = alternative['evidenceId']
    return MaturedWaitOutcome(
        underlying_price_at_decision=underlying_price_at_decision,
        underlying_price_at_maturation=underlying_price_at_maturation, maturation_timestamp=maturation_timestamp,
        horizon_return=horizon_return, opportunity_cost_vs_best_rejected=opportunity_cost,
        truth_class=observation_truth_class, counterfactual_truth_class=truth, counterfactual_evidence_id=evidence_id,
    )
