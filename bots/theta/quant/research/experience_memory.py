"""Evidence retrieval by strategy/regime/DTE/delta/IV/skew/flow/management/
drawdown/recovery/reason code (work package 65).

This is retrieval, not a selector: `query()` returns every stored episode
record matching the caller's filters, in a deterministic order, and never
ranks, scores, or silently narrows the result toward one outcome. It is not
a policy input and never claims which past episode is "most similar" --
that judgment (if ever wanted) is a distinct, not-yet-built module, kept
separate on purpose so this one stays a transparent evidence lookup.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple


@dataclass(frozen=True)
class ExperienceRecord:
    episode_id: str
    strategy: Optional[str]
    regime: Optional[str]
    dte_bucket: Optional[str]
    delta_bucket: Optional[str]
    iv_bucket: Optional[str]
    skew_bucket: Optional[str]
    flow_bucket: Optional[str]
    management_action: Optional[str]
    drawdown_bucket: Optional[str]
    recovery_state: Optional[str]
    reason_codes: Tuple[str, ...]
    evidence_ref: str  # pointer to the full evidence record (episode/candidate/label id), never inlined here


_INDEXED_FIELDS = (
    'strategy', 'regime', 'dte_bucket', 'delta_bucket', 'iv_bucket', 'skew_bucket',
    'flow_bucket', 'management_action', 'drawdown_bucket', 'recovery_state',
)


class ExperienceMemory:
    def __init__(self) -> None:
        self._records: Dict[str, ExperienceRecord] = {}

    def add(self, record: ExperienceRecord) -> None:
        existing = self._records.get(record.episode_id)
        if existing is not None and existing != record:
            raise ValueError('EXPERIENCE_MEMORY_EPISODE_ID_CONFLICT')
        self._records[record.episode_id] = record

    def query(
        self, reason_code: Optional[str] = None, **field_filters: Optional[str]
    ) -> Tuple[ExperienceRecord, ...]:
        unknown = [key for key in field_filters if key not in _INDEXED_FIELDS]
        if unknown:
            raise ValueError(f'EXPERIENCE_MEMORY_UNKNOWN_FILTER_FIELD:{unknown[0]}')
        results = []
        for record in self._records.values():
            if any(getattr(record, key) != value for key, value in field_filters.items() if value is not None):
                continue
            if reason_code is not None and reason_code not in record.reason_codes:
                continue
            results.append(record)
        return tuple(sorted(results, key=lambda r: r.episode_id))

    def __len__(self) -> int:
        return len(self._records)
