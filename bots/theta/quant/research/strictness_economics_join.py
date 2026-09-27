"""Join typed strictness-funnel rejections to later outcomes, only when
candidate identity and horizon are both valid (work package 75).

A REJECTED candidate was never executed -- there is no fill, no real
economic outcome FOR THE REJECTION ITSELF. What this join can honestly
answer is narrower and different: did the SAME candidate identity later
appear in some other real evidence source (a shadow-candidate replay, a
counterfactual WAIT-outcome record) with a resolved, mature outcome? If
so, that outcome may inform whether the rejection was economically costly
-- but this module never manufactures a fill or a causal claim; it only
performs the join and names exactly why a row could not join when it
can't.
"""
from __future__ import annotations

from typing import Callable, Dict, Sequence


def join_strictness_to_outcomes(
    strictness_rows: Sequence[object], outcomes_by_candidate_id: Dict[str, dict],
    horizon_valid_fn: Callable[[object, dict], bool],
) -> dict:
    joined = []
    unjoined = []
    for row in strictness_rows:
        candidate_id = getattr(row, 'candidate_id', None)
        if not candidate_id:
            unjoined.append({'reasonCode': row.reason_code, 'state': 'CANDIDATE_IDENTITY_MISSING'})
            continue
        outcome = outcomes_by_candidate_id.get(candidate_id)
        if outcome is None:
            unjoined.append({'candidateId': candidate_id, 'reasonCode': row.reason_code, 'state': 'NO_OUTCOME_AVAILABLE'})
            continue
        if not horizon_valid_fn(row, outcome):
            unjoined.append({'candidateId': candidate_id, 'reasonCode': row.reason_code, 'state': 'HORIZON_INVALID'})
            continue
        joined.append({
            'candidateId': candidate_id, 'reasonCode': row.reason_code, 'strategy': row.strategy, 'date': row.date,
            'outcome': outcome, 'state': 'JOINED', 'executionAuthority': False,
            'causalClaim': 'NONE_THIS_IS_AN_OBSERVATIONAL_JOIN_NOT_A_COUNTERFACTUAL_ESTIMATE',
        })
    return {
        'version': 'theta-strictness-economics-join-v1', 'joined': joined, 'unjoined': unjoined,
        'joinedCount': len(joined), 'unjoinedCount': len(unjoined),
        'state': 'ROWS_JOINED' if joined else 'NO_ELIGIBLE_JOINS',
    }
