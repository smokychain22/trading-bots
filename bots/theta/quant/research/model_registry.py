"""General cross-task model registry (work package 57).

Generalizes the existing task-specific pattern in
`severe_drawdown_model_contract.py`'s `SevereDrawdownArtifactRegistry`
(hash-verified, immutable-by-version, promotion-state-gated) to any task
(entry, management, fill, regime, severe-drawdown, ...) instead of adding a
second, task-duplicated registry. The severe-drawdown registry is left in
place -- it is not migrated here in this pass, since that would touch a
mature, independently-tested module outside this work package's scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Mapping, Optional, Tuple
from research.production_export_loader import canonical_json, sha256_hex

PROMOTION_STATES = (
    'RESEARCH_FIT_NOT_PROMOTED', 'MODEL_PAPER_RISK_ELIGIBLE', 'MODEL_EMPIRICALLY_PROMOTED', 'MODEL_ROLLED_BACK',
)


@dataclass(frozen=True)
class ModelRegistryEntry:
    task: str
    model_version: str
    source_sha: str
    dataset_hash: str
    feature_version: str
    label_version: str
    split_hash: str
    hyperparam_hash: str
    calibration: Mapping[str, object]
    metrics: Mapping[str, object]
    promotion_state: str
    created_at: str
    entry_hash: str = field(compare=False)


def _entry_hash(payload: Mapping[str, object]) -> str:
    return sha256_hex(canonical_json(payload))


def build_registry_entry(**values: object) -> ModelRegistryEntry:
    if values.get('promotion_state') not in PROMOTION_STATES:
        raise ValueError('MODEL_REGISTRY_UNSUPPORTED_PROMOTION_STATE')
    for required in ('task', 'model_version', 'source_sha', 'dataset_hash', 'feature_version',
                     'label_version', 'split_hash', 'hyperparam_hash', 'created_at'):
        if not values.get(required):
            raise ValueError(f'MODEL_REGISTRY_FIELD_REQUIRED:{required}')
    payload = dict(values)
    expected = _entry_hash(payload)
    return ModelRegistryEntry(**payload, entry_hash=expected)  # type: ignore[arg-type]


class ModelRegistry:
    """Process-local registry. Durable adapters implement the same rules:
    immutable per (task, model_version) once registered. A rollback is
    registered as an ordinary new entry (a new model_version, promotion_state
    MODEL_ROLLED_BACK) through `register()` -- never a silent overwrite or
    delete of the entry it supersedes, which remains queryable via `get()`."""

    def __init__(self) -> None:
        self._entries: Dict[Tuple[str, str], ModelRegistryEntry] = {}

    def register(self, entry: ModelRegistryEntry) -> None:
        payload = dict(entry.__dict__)
        claimed_hash = payload.pop('entry_hash')
        if _entry_hash(payload) != claimed_hash:
            raise ValueError('MODEL_REGISTRY_ENTRY_HASH_MISMATCH')
        key = (entry.task, entry.model_version)
        existing = self._entries.get(key)
        if existing is not None and existing.entry_hash != entry.entry_hash:
            raise ValueError('MODEL_REGISTRY_VERSION_IS_IMMUTABLE')
        self._entries[key] = entry

    def get(self, task: str, model_version: str) -> Optional[ModelRegistryEntry]:
        return self._entries.get((task, model_version))

    def promoted(self, task: Optional[str] = None) -> Tuple[ModelRegistryEntry, ...]:
        eligible = ('MODEL_PAPER_RISK_ELIGIBLE', 'MODEL_EMPIRICALLY_PROMOTED')
        return tuple(sorted(
            (item for item in self._entries.values()
             if item.promotion_state in eligible and (task is None or item.task == task)),
            key=lambda item: (item.task, item.created_at, item.model_version),
        ))
