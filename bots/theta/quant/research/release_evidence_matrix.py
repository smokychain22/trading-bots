"""Release evidence matrix (work package 94).

Classifies each named release criterion into exactly one of five states
-- never a sixth ad hoc state, never a blended "mostly pass." A criterion
whose evidence lives outside this research layer (a Codex runtime check,
an infra health check) is `EXTERNAL_RUNTIME_REQUIRED`, distinct from
`INSUFFICIENT_DATA` (evidence belongs here but hasn't been produced yet).
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

RELEASE_EVIDENCE_STATES = ('PASS_EVIDENCE_PRESENT', 'FAIL', 'INSUFFICIENT_DATA', 'EXTERNAL_RUNTIME_REQUIRED', 'NOT_APPLICABLE')


def classify_release_criterion(
    criterion_id: str, evidence: Optional[Any], is_external_runtime: bool, is_applicable: bool,
    pass_check: Optional[Callable[[Any], bool]] = None,
) -> dict:
    if not is_applicable:
        return {'criterionId': criterion_id, 'state': 'NOT_APPLICABLE', 'reason': 'CRITERION_DOES_NOT_APPLY'}
    if is_external_runtime:
        return {'criterionId': criterion_id, 'state': 'EXTERNAL_RUNTIME_REQUIRED',
                'reason': 'EVIDENCE_LIVES_OUTSIDE_RESEARCH_LAYER'}
    if evidence is None:
        return {'criterionId': criterion_id, 'state': 'INSUFFICIENT_DATA', 'reason': 'NO_EVIDENCE_PRODUCED_YET'}
    if pass_check is None:
        raise ValueError(f'RELEASE_EVIDENCE_MATRIX_PASS_CHECK_REQUIRED:{criterion_id}')
    passed = pass_check(evidence)
    return {'criterionId': criterion_id, 'state': 'PASS_EVIDENCE_PRESENT' if passed else 'FAIL',
            'reason': 'EVIDENCE_MEETS_CRITERION' if passed else 'EVIDENCE_PRESENT_BUT_FAILS_CRITERION'}


def build_release_evidence_matrix(criteria: Dict[str, dict]) -> dict:
    """`criteria` maps criterion_id -> kwargs for classify_release_criterion
    (minus criterion_id itself)."""
    rows = {criterion_id: classify_release_criterion(criterion_id, **kwargs) for criterion_id, kwargs in criteria.items()}
    states_present = {row['state'] for row in rows.values()}
    overall = 'PASS_EVIDENCE_PRESENT' if states_present <= {'PASS_EVIDENCE_PRESENT', 'NOT_APPLICABLE'} else \
        'FAIL' if 'FAIL' in states_present else \
        'EXTERNAL_RUNTIME_REQUIRED' if 'EXTERNAL_RUNTIME_REQUIRED' in states_present else 'INSUFFICIENT_DATA'
    return {'version': 'theta-release-evidence-matrix-v1', 'rows': rows, 'overallState': overall}
