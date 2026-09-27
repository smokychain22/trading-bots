"""Storage classification for research artifacts (work package 85).

Five classes, reusing the exact vocabulary `future_capture_contract.py`
(WP67) already introduced -- not a second taxonomy:

- `SOURCE_CONTROL`: small, versioned, human-reviewable (code, manifests,
  hashes, config, small fixtures, feature/experiment definitions).
- `LOCAL_ANALYTICS`: derived research outputs kept on the research
  machine, reproducible from source control + archive, not itself
  authoritative.
- `ARCHIVE`: large, immutable historical evidence (converted row data,
  backup snapshots) -- never committed to Git.
- `EPHEMERAL`: safe to delete any time (scratch/temp intermediate files).
- `COMPACT_DB_HANDOFF`: a small, hashed pointer/manifest a durable store
  can ingest, distinct from the large data it points at.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from research.future_capture_contract import STORAGE_CLASSES

# Above this size, an artifact can never be classified SOURCE_CONTROL,
# regardless of kind -- large converted history never goes into Git.
SOURCE_CONTROL_MAX_BYTES = 1_000_000

_KIND_DEFAULT_CLASS = {
    'CODE': 'SOURCE_CONTROL', 'TEST_FIXTURE': 'SOURCE_CONTROL', 'FEATURE_DEFINITION': 'SOURCE_CONTROL',
    'EXPERIMENT_DEFINITION': 'SOURCE_CONTROL', 'MANIFEST': 'SOURCE_CONTROL', 'CONFIG': 'SOURCE_CONTROL',
    'CONVERTED_HISTORICAL_ROWS': 'ARCHIVE', 'BACKUP_SNAPSHOT': 'ARCHIVE', 'RAW_EXPORT': 'ARCHIVE',
    'DERIVED_DATASET': 'LOCAL_ANALYTICS', 'MODEL_ARTIFACT': 'LOCAL_ANALYTICS', 'REPORT': 'LOCAL_ANALYTICS',
    'SCRATCH_FILE': 'EPHEMERAL', 'TEMP_INTERMEDIATE': 'EPHEMERAL',
    'DB_HANDOFF_MANIFEST': 'COMPACT_DB_HANDOFF',
}


@dataclass(frozen=True)
class StorageClassification:
    artifactKind: str
    storageClass: str
    sizeBytes: Optional[int]
    reason: str


def classify_artifact(artifact_kind: str, size_bytes: Optional[int] = None) -> StorageClassification:
    if artifact_kind not in _KIND_DEFAULT_CLASS:
        raise ValueError(f'STORAGE_CLASSIFICATION_UNKNOWN_ARTIFACT_KIND:{artifact_kind}')
    default_class = _KIND_DEFAULT_CLASS[artifact_kind]
    if default_class == 'SOURCE_CONTROL' and size_bytes is not None and size_bytes > SOURCE_CONTROL_MAX_BYTES:
        return StorageClassification(
            artifact_kind, 'ARCHIVE', size_bytes,
            f'SIZE_{size_bytes}_EXCEEDS_SOURCE_CONTROL_MAX_{SOURCE_CONTROL_MAX_BYTES}_BYTES_NEVER_COMMITTED_TO_GIT',
        )
    return StorageClassification(artifact_kind, default_class, size_bytes, f'DEFAULT_CLASS_FOR_KIND:{artifact_kind}')
