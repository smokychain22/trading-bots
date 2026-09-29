"""Q-blocked / D-available cohort identification (work package 76).

Identifies decisions where the conventional CSP (Q / THETA_CONVENTIONAL)
branch was hard-blocked while a defined-risk (D / THETA_DEFINED_RISK)
candidate existed with a common T0 and comparable evidence. This module
only IDENTIFIES cohort membership -- it never asserts D should have been
executed instead. D's own execution authority (whether to route to D,
size it, submit it) belongs entirely to the router/execution layer this
module does not touch.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence


def identify_q_blocked_d_available_cohort(candidates: Sequence[Any]) -> dict:
    by_decision: Dict[str, Dict[str, list]] = {}
    for candidate in candidates:
        decision_id = candidate.decision_id
        if decision_id is None:
            continue
        by_decision.setdefault(decision_id, {}).setdefault(candidate.branch.value, []).append(candidate)

    members: List[Dict[str, Any]] = []
    for decision_id, by_branch in sorted(by_decision.items()):
        q_candidates = by_branch.get('THETA_CONVENTIONAL', [])
        d_candidates = by_branch.get('THETA_DEFINED_RISK', [])
        q_blocked = [c for c in q_candidates if c.hard_status.value != 'FEASIBLE']
        d_available = [c for c in d_candidates if c.hard_status.value == 'FEASIBLE']
        if q_blocked and d_available:
            members.append({
                'decisionId': decision_id,
                'qBlockedCandidateIds': sorted(c.candidate_id for c in q_blocked),
                'dAvailableCandidateIds': sorted(c.candidate_id for c in d_available),
                'dExecutionAuthority': False,  # this module never asserts D should have been executed
            })
    return {
        'version': 'theta-q-blocked-d-available-cohort-v1', 'members': members, 'memberCount': len(members),
        'state': 'COHORT_IDENTIFIED' if members else 'NO_COHORT_MEMBERS',
    }
