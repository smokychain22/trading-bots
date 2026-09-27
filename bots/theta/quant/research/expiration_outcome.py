"""Expiration outcome resolver (work package 69).

Distinct from, and reuses the truth hierarchy of, `assignment_labels.py`
(work package 40) -- that module answers the narrower ASSIGNED/
NOT_ASSIGNED/CENSORED/UNKNOWN question from broker evidence alone. This
module resolves the FULL expiration lifecycle state, which needs
additional inputs (whether the position closed before expiry at all,
whether the contract was ITM at expiration, and long-side exercise
evidence), while preserving the same non-negotiable rule: moneyness alone
never determines assignment.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class ExpirationOutcomeState(str, Enum):
    EXPIRED_OTM = 'EXPIRED_OTM'
    EXPIRED_ITM_NO_ASSIGNMENT_EVIDENCE = 'EXPIRED_ITM_NO_ASSIGNMENT_EVIDENCE'
    ASSIGNED = 'ASSIGNED'
    EXERCISED = 'EXERCISED'
    CLOSED_BEFORE_EXPIRY = 'CLOSED_BEFORE_EXPIRY'
    UNKNOWN = 'UNKNOWN'
    CENSORED = 'CENSORED'


@dataclass(frozen=True)
class ExpirationEvidenceInput:
    option_symbol: str
    closed_before_expiry_observed: Optional[bool]  # a real, documented BTC/close fill before expiration
    contract_has_matured: bool  # False (still open, not yet at/after expiration) => CENSORED
    itm_at_expiration_observed: Optional[bool]  # a real settlement-price-derived fact, never inferred from a live quote
    broker_assignment_event_observed: Optional[bool]
    broker_exercise_event_observed: Optional[bool]  # long-side exercise (this contract was exercised, not assigned)


@dataclass(frozen=True)
class ExpirationOutcomeResult:
    state: ExpirationOutcomeState
    future_identifiable_fields: tuple


def resolve_expiration_outcome(evidence: ExpirationEvidenceInput) -> ExpirationOutcomeResult:
    if evidence.closed_before_expiry_observed is True:
        return ExpirationOutcomeResult(ExpirationOutcomeState.CLOSED_BEFORE_EXPIRY, ())
    if not evidence.contract_has_matured:
        return ExpirationOutcomeResult(
            ExpirationOutcomeState.CENSORED,
            ('closed_before_expiry_observed', 'contract_has_matured'),
        )
    if evidence.broker_exercise_event_observed is True:
        return ExpirationOutcomeResult(ExpirationOutcomeState.EXERCISED, ())
    if evidence.broker_assignment_event_observed is True:
        return ExpirationOutcomeResult(ExpirationOutcomeState.ASSIGNED, ())
    if evidence.itm_at_expiration_observed is False:
        return ExpirationOutcomeResult(ExpirationOutcomeState.EXPIRED_OTM, ())
    if evidence.itm_at_expiration_observed is True:
        # ITM at expiration is NOT proof of assignment -- the charter's own
        # non-negotiable rule. Without a real broker assignment/exercise
        # event, this stays its own distinct, non-committal state.
        return ExpirationOutcomeResult(
            ExpirationOutcomeState.EXPIRED_ITM_NO_ASSIGNMENT_EVIDENCE,
            ('broker_assignment_event_observed', 'broker_exercise_event_observed'),
        )
    return ExpirationOutcomeResult(
        ExpirationOutcomeState.UNKNOWN,
        ('itm_at_expiration_observed', 'broker_assignment_event_observed', 'broker_exercise_event_observed'),
    )
