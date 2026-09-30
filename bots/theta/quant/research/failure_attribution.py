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
from math import isfinite
from datetime import datetime
from research.production_export_loader import canonical_json, sha256_hex

ATTRIBUTION_LABELS = (
    'DECISION', 'CONTRACT', 'SIZE', 'LIMIT', 'EXECUTION', 'REGIME', 'FLOW',
    'MANAGEMENT', 'PROVIDER', 'STATE_MACHINE', 'ACCOUNTING', 'DATA_QUALITY',
)
CAUSE_DIMENSIONS = ('STRATEGY_SELECTION', 'STRIKE', 'DTE', 'ENTRY_TIMING', 'UNDERLYING_MOVE', 'IV', 'SKEW',
                    'TERM_STRUCTURE', 'REGIME', 'EVENT', 'LIQUIDITY', 'EXECUTION', 'SLIPPAGE', 'SIZING',
                    'AEGIS', 'MANAGEMENT', 'ROLL', 'ASSIGNMENT', 'RECOVERY', 'PROVIDER', 'SYSTEM')


def attribute_failure(evidence: Dict[str, object]) -> dict:
    """`evidence` carries whatever named, already-observed facts the
    caller has (e.g. `dataQuality`, `contractHardBlockers`, `fillLatencySeconds`,
    `regimeConfidence`, `managementReasonCodes`, `accountingReconciled`) --
    this function never infers a fact that isn't explicitly present."""
    labels: List[str] = []
    reasons: Dict[str, str] = {}
    for field in ('fillLatencySeconds', 'fillLatencySecondsPolicyMax'):
        value = evidence.get(field)
        if value is not None and (type(value) not in (float, int) or not isfinite(value) or value < 0):
            raise ValueError('FAILURE_ATTRIBUTION_LATENCY_INVALID')
    causes = evidence.get('causeEvidence', [])
    if not isinstance(causes, list):
        raise ValueError('FAILURE_ATTRIBUTION_CAUSES_INVALID')
    identities = set()
    for cause in causes:
        if not isinstance(cause, dict) or cause.get('cause') not in CAUSE_DIMENSIONS or not cause.get('reason') or not cause.get('evidenceId'):
            raise ValueError('FAILURE_ATTRIBUTION_CAUSE_PROVENANCE_REQUIRED')
        identity = (cause['cause'], cause['evidenceId'])
        if identity in identities:
            raise ValueError('FAILURE_ATTRIBUTION_DUPLICATE_CAUSE')
        identities.add(identity)
        observed = datetime.fromisoformat(cause['observedAt'].replace('Z', '+00:00'))
        if observed.tzinfo is None:
            raise ValueError('FAILURE_ATTRIBUTION_CAUSE_TIMEZONE_REQUIRED')

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
        'causeEvidence': sorted(causes, key=lambda c: (c['cause'], c['evidenceId'])),
        'scope': 'REPORTED_CONTRIBUTING_FACTS_NOT_PROVEN_CAUSAL_EFFECT',
        'brokerAuthority': False,
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


def attribute_export_failures(export) -> dict:
    """Bind provider-quality observations to exact exported candidate identity.

    Unknown source quality is missing evidence, not a proved loss cause. No
    inference from a realized win/loss changes a historical decision label.
    """
    rows = []
    for candidate in export.candidates:
        observations = []
        for source in candidate.provider_provenance:
            if source.state.value in ('STALE', 'INVALID', 'NOT_ENTITLED', 'DEGRADED'):
                observations.append({'source': source.source, 'operation': source.operation_alias,
                                     'asOf': source.as_of, 'state': source.state.value})
        facts = {'dataQuality': 'DEGRADED'} if observations else {}
        rows.append({'candidateId': candidate.candidate_id, 'decisionId': candidate.decision_id,
                     'sourceContentHash': candidate.content_hash, 'decisionAt': candidate.decision_time,
                     'observations': observations, 'attribution': attribute_failure(facts)})
    payload = {'version': 'theta-export-failure-attribution-v1', 'datasetHash': export.dataset_hash,
               'rows': sorted(rows, key=lambda r: r['candidateId']), 'brokerAuthority': False}
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
