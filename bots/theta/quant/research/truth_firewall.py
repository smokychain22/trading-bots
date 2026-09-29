"""Truth-class promotion firewall (work package 71).

A handful of truth-class transitions must never happen silently anywhere
in this codebase: `MODELED_RESEARCH` -> `BROKER_ACTUAL`, `SYNTHETIC_FIXTURE`
-> `REAL_HISTORICAL`, `RECONSTRUCTED` -> `BROKER_ACTUAL`, and
`RESEARCH_BASELINE` -> `PRODUCTION_CANONICAL` (the last one is exactly the
promotion `skew.py`'s own `RESEARCH_BASELINE_NOT_PRODUCTION_POLICY`
constant exists to prevent). `assert_truth_class_transition_allowed()` is
the one place any caller checks before letting a value's truth class
change -- it raises unless real, complete promotion evidence is supplied,
never a bare boolean flag.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

FORBIDDEN_SILENT_TRANSITIONS: Tuple[Tuple[str, str], ...] = (
    ('MODELED_RESEARCH', 'BROKER_ACTUAL'),
    ('SYNTHETIC_FIXTURE', 'REAL_HISTORICAL'),
    ('RECONSTRUCTED', 'BROKER_ACTUAL'),
    ('RESEARCH_BASELINE', 'PRODUCTION_CANONICAL'),
)
_REQUIRED_PROMOTION_EVIDENCE_FIELDS = ('promotedBy', 'promotedAt', 'evidenceReference', 'promotionDecisionId')


def assert_truth_class_transition_allowed(
    from_truth_class: str, to_truth_class: str, promotion_evidence: Optional[Dict[str, object]] = None,
) -> bool:
    """Returns True (never False -- an invalid transition raises instead of
    returning a falsy value a caller could accidentally ignore)."""
    if (from_truth_class, to_truth_class) not in FORBIDDEN_SILENT_TRANSITIONS:
        return True
    if promotion_evidence is None:
        raise ValueError(f'TRUTH_FIREWALL_SILENT_PROMOTION_BLOCKED:{from_truth_class}->{to_truth_class}')
    missing = [field for field in _REQUIRED_PROMOTION_EVIDENCE_FIELDS if not promotion_evidence.get(field)]
    if missing:
        raise ValueError(f'TRUTH_FIREWALL_PROMOTION_EVIDENCE_INCOMPLETE:{missing[0]}')
    return True
