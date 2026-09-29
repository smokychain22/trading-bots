"""Frozen untouched-OOS manifest + tuning-time reject guard (work package 52).

`validation.py`'s `build_purged_walk_forward_plan`/`build_grouped_walk_forward_plan`
already reserve a `final_oos_ids` suffix and never let it influence a split
(see its own docstring: "Final OOS labels are never consumed to design a
split."). This module does not re-derive that reservation -- it freezes the
IDs that reservation already produced into one hashed, immutable manifest
(dataset hash, scope/date bounds, creation SHA, split version) and gives
tuning code an explicit guard to call, so a threshold-selection or
hyperparameter-search path that accidentally reaches into the OOS set fails
loudly instead of silently leaking it.
"""
from __future__ import annotations

from datetime import datetime
from typing import Mapping, Sequence
from research.production_export_loader import canonical_json, sha256_hex


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('OOS_MANIFEST_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


def freeze_oos_manifest(
    final_oos_ids: Sequence[str], observed_at_by_id: Mapping[str, str],
    dataset_hash: str, creation_sha: str, split_version: str,
):
    if not dataset_hash or not creation_sha or not split_version:
        raise ValueError('OOS_MANIFEST_PROVENANCE_REQUIRED')
    missing = [i for i in final_oos_ids if i not in observed_at_by_id]
    if missing:
        raise ValueError(f'OOS_MANIFEST_OBSERVED_AT_MISSING:{sorted(missing)[0]}')
    ids = sorted(set(final_oos_ids))
    if len(ids) != len(final_oos_ids):
        raise ValueError('OOS_MANIFEST_DUPLICATE_ID')
    dates = sorted(_time(observed_at_by_id[i]) for i in ids)
    manifest = {
        'version': 'theta-oos-manifest-v1', 'datasetHash': dataset_hash, 'creationSha': creation_sha,
        'splitVersion': split_version, 'finalOosIds': ids, 'scopeCount': len(ids),
        'dateBounds': {'start': dates[0].isoformat(), 'end': dates[-1].isoformat()} if dates else None,
        'frozen': True, 'usedForTuning': False,
    }
    return {**manifest, 'contentHash': sha256_hex(canonical_json(manifest))}


def assert_not_used_for_tuning(candidate_ids: Sequence[str], manifest: Mapping[str, object]) -> None:
    """Raise loudly if any id a tuning/threshold-selection path is about to
    touch is inside the frozen OOS manifest. Never a warning, never a
    silently-dropped id -- the whole point is that this fails the caller."""
    if not manifest.get('frozen'):
        raise ValueError('OOS_MANIFEST_NOT_FROZEN')
    overlap = sorted(set(candidate_ids) & set(manifest['finalOosIds']))
    if overlap:
        raise ValueError(f'OOS_MANIFEST_TUNING_VIOLATION:{overlap[0]}')
