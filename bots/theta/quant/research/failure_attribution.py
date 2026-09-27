"""Evidence-backed, multi-label failure attribution (work package 64).

Attributes an unfavorable outcome to one or more of DECISION, CONTRACT,
SIZE, LIMIT, EXECUTION, REGIME, FLOW, MANAGEMENT, PROVIDER, STATE_MACHINE,
ACCOUNTING, DATA_QUALITY -- multi-label because a single bad outcome
routinely has more than one contributing cause. Every label attached here
must cite the specific evidence field that supports it; there is no
"catch-all" label and no attribution without a named reason. An outcome
with no positively-identified cause is `UNATTRIBUTED`, never forced into
the nearest-sounding category.
"""
from __future__ import annotations

from typing import Dict, List
from research.production_export_loader import canonical_json, sha256_hex

ATTRIBUTION_LABELS = (
    'DECISION', 'CONTRACT', 'SIZE', 'LIMIT', 'EXECUTION', 'REGIME', 'FLOW',
    'MANAGEMENT', 'PROVIDER', 'STATE_MACHINE', 'ACCOUNTING', 'DATA_QUALITY',
)


def attribute_failure(evidence: Dict[str, object]) -> dict:
    """`evidence` carries whatever named, already-observed facts the
    caller has (e.g. `dataQuality`, `contractHardBlockers`, `fillLatencySeconds`,
    `regimeConfidence`, `managementReasonCodes`, `accountingReconciled`) --
    this function never infers a fact that isn't explicitly present."""
    labels: List[str] = []
    reasons: Dict[str, str] = {}

    def attach(label: str, reason: str) -> None:
        if label not in labels:
            labels.append(label)
        reasons[label] = reason

    if evidence.get('dataQuality') not in (None, 'GOOD'):
        attach('DATA_QUALITY', f"dataQuality={evidence.get('dataQuality')}")
    if evidence.get('providerOutageObserved') is True:
        attach('PROVIDER', 'providerOutageObserved=True')
    if evidence.get('contractHardBlockers'):
        attach('CONTRACT', f"contractHardBlockers={evidence.get('contractHardBlockers')}")
    if evidence.get('sizingReasonCodes'):
        attach('SIZE', f"sizingReasonCodes={evidence.get('sizingReasonCodes')}")
    if evidence.get('limitPriceRejectedReason'):
        attach('LIMIT', f"limitPriceRejectedReason={evidence.get('limitPriceRejectedReason')}")
    if evidence.get('fillLatencySeconds') is not None and evidence.get('fillLatencySecondsPolicyMax') is not None \
            and evidence['fillLatencySeconds'] > evidence['fillLatencySecondsPolicyMax']:
        attach('EXECUTION', f"fillLatencySeconds={evidence['fillLatencySeconds']}>policyMax={evidence['fillLatencySecondsPolicyMax']}")
    if evidence.get('regimeMisclassifiedAfterFact') is True:
        attach('REGIME', 'regimeMisclassifiedAfterFact=True')
    if evidence.get('flowSignalContradictedOutcome') is True:
        attach('FLOW', 'flowSignalContradictedOutcome=True')
    if evidence.get('managementReasonCodes'):
        attach('MANAGEMENT', f"managementReasonCodes={evidence.get('managementReasonCodes')}")
    if evidence.get('lifecycleTransitionRejected') is True:
        attach('STATE_MACHINE', 'lifecycleTransitionRejected=True')
    if evidence.get('accountingReconciled') is False:
        attach('ACCOUNTING', 'accountingReconciled=False')
    if evidence.get('decisionOverriddenReasonCodes'):
        attach('DECISION', f"decisionOverriddenReasonCodes={evidence.get('decisionOverriddenReasonCodes')}")

    unknown_labels = [label for label in labels if label not in ATTRIBUTION_LABELS]
    if unknown_labels:
        raise ValueError(f'FAILURE_ATTRIBUTION_UNKNOWN_LABEL:{unknown_labels[0]}')

    payload = {
        'version': 'theta-failure-attribution-v1',
        'labels': labels if labels else ['UNATTRIBUTED'],
        'reasons': reasons,
        'evidenceKeysConsidered': sorted(evidence.keys()),
        'state': 'ATTRIBUTED' if labels else 'UNATTRIBUTED_NO_MATCHING_EVIDENCE',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
