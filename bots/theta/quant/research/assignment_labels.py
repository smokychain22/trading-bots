"""Assignment label builder (THETA long-run build, work package 40).

Truth hierarchy, strictly in this order -- never inferred from strike
crossing alone (a short put finishing ITM is NOT proof of assignment; the
broker's own lifecycle event is the only truth-bearing signal):

1. `BROKER_ACTUAL` -- a real Alpaca assignment/exercise event exists.
2. `DOCUMENTED_LIFECYCLE_EVIDENCE` -- no direct broker assignment event,
   but a real, documented downstream lifecycle fact (e.g. a real stock
   position materialized in the account that traces to this contract)
   confirms it happened.
3. `UNKNOWN` -- neither exists. Never defaulted to NOT_ASSIGNED just
   because the option finished OTM-adjacent or because no evidence was
   looked for.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class AssignmentLabel(str, Enum):
    ASSIGNED = "ASSIGNED"
    NOT_ASSIGNED = "NOT_ASSIGNED"
    CENSORED = "CENSORED"  # the contract has not yet reached a resolvable lifecycle state
    UNKNOWN = "UNKNOWN"


class AssignmentTruthSource(str, Enum):
    BROKER_ACTUAL = "BROKER_ACTUAL"
    DOCUMENTED_LIFECYCLE_EVIDENCE = "DOCUMENTED_LIFECYCLE_EVIDENCE"
    NONE = "NONE"


@dataclass(frozen=True)
class AssignmentEvidenceInput:
    option_symbol: str
    broker_assignment_event_observed: Optional[bool]  # real Alpaca event, None if never checked
    documented_stock_position_traces_to_contract: Optional[bool]  # real, documented downstream fact
    contract_has_matured: bool  # past expiration/exercise cutoff -- False means still open, CENSORED


@dataclass(frozen=True)
class AssignmentLabelResult:
    label: AssignmentLabel
    truth_source: AssignmentTruthSource
    future_identifiable_fields: tuple  # named fields that WOULD resolve this if/when observed


def build_assignment_label(evidence: AssignmentEvidenceInput) -> AssignmentLabelResult:
    if evidence.broker_assignment_event_observed is True:
        return AssignmentLabelResult(
            label=AssignmentLabel.ASSIGNED, truth_source=AssignmentTruthSource.BROKER_ACTUAL,
            future_identifiable_fields=(),
        )
    if evidence.broker_assignment_event_observed is False and evidence.documented_stock_position_traces_to_contract is False:
        # A real broker check ran and found no assignment event, AND no
        # documented downstream stock position traces to this contract --
        # this is a real, positive NOT_ASSIGNED fact, not an absence.
        return AssignmentLabelResult(
            label=AssignmentLabel.NOT_ASSIGNED, truth_source=AssignmentTruthSource.BROKER_ACTUAL,
            future_identifiable_fields=(),
        )
    if evidence.documented_stock_position_traces_to_contract is True:
        return AssignmentLabelResult(
            label=AssignmentLabel.ASSIGNED, truth_source=AssignmentTruthSource.DOCUMENTED_LIFECYCLE_EVIDENCE,
            future_identifiable_fields=(),
        )
    if not evidence.contract_has_matured:
        return AssignmentLabelResult(
            label=AssignmentLabel.CENSORED, truth_source=AssignmentTruthSource.NONE,
            future_identifiable_fields=("broker_assignment_event_observed", "documented_stock_position_traces_to_contract"),
        )
    return AssignmentLabelResult(
        label=AssignmentLabel.UNKNOWN, truth_source=AssignmentTruthSource.NONE,
        future_identifiable_fields=("broker_assignment_event_observed", "documented_stock_position_traces_to_contract"),
    )
