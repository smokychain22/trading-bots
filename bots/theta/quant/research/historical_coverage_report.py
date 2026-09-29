"""Deduped historical coverage report (work package 74).

Takes an already-deduplicated sequence of `Candidate` objects (the caller
must dedupe first -- via `historical_export_dedupe.py` at the archive-copy
level, and by `candidate_id` at the row-identity level -- this module
never re-derives that dedup, and never counts a backup copy twice).
Reports population-level coverage: strategy/branch distribution,
selected-vs-not, hard/soft status distribution, and non-empty coverage
of every opaque feature family on `Candidate`.
"""
from __future__ import annotations

from typing import Any, Dict, Sequence

_FEATURE_FAMILIES = (
    'volatility', 'technical', 'event', 'flow', 'ownership', 'account', 'portfolio', 'aegis', 'execution', 'known_economics',
)


def build_historical_coverage_report(unique_candidates: Sequence[Any]) -> Dict[str, Any]:
    ids = [c.candidate_id for c in unique_candidates]
    if len(set(ids)) != len(ids):
        raise ValueError('HISTORICAL_COVERAGE_REPORT_INPUT_NOT_DEDUPED')

    total = len(unique_candidates)
    branch_dist: Dict[str, int] = {}
    hard_status_dist: Dict[str, int] = {}
    soft_status_dist: Dict[str, int] = {}
    selected_count = 0
    feature_coverage = {family: 0 for family in _FEATURE_FAMILIES}
    for candidate in unique_candidates:
        branch_dist[candidate.branch.value] = branch_dist.get(candidate.branch.value, 0) + 1
        hard_status_dist[candidate.hard_status.value] = hard_status_dist.get(candidate.hard_status.value, 0) + 1
        soft_status_dist[candidate.soft_status.value] = soft_status_dist.get(candidate.soft_status.value, 0) + 1
        if candidate.selected:
            selected_count += 1
        for family in _FEATURE_FAMILIES:
            if getattr(candidate, family):
                feature_coverage[family] += 1

    return {
        'version': 'theta-historical-coverage-report-v1', 'uniqueCandidateCount': total,
        'selectedCandidateCount': selected_count,
        'selectedFraction': (selected_count / total) if total else None,
        'branchDistribution': branch_dist, 'hardStatusDistribution': hard_status_dist,
        'softStatusDistribution': soft_status_dist,
        'featureFamilyNonEmptyCoverage': feature_coverage,
        'featureFamilyNonEmptyFraction': {k: (v / total if total else None) for k, v in feature_coverage.items()},
    }
