"""Deduplicate archived historical research-export directories before
counting anything as unique empirical N (V4 section 1).

Two distinct duplication mechanisms were found in the real archive under
`C:\\ProjectBackups\\trading-bots\\daily\\...\\external-assets\\research_exports\\`,
and this module addresses both, in order:

1. **Archive-copy duplication**: a daily/staged backup snapshot re-copies
   the SAME export directory verbatim on every run that finds nothing new
   to export. Identity here is the manifest's own byte content (strongest:
   catches a re-copy even if `datasetHash` were ever wrong or absent),
   falling back to the declared `datasetHash` field, then to
   `(sourceWindow.start, sourceWindow.end, featureSetVersion)` if neither
   hash is present. This collapses N raw directories into the count of
   truly distinct export SNAPSHOTS.

2. **Cross-snapshot row duplication**: distinct export snapshots (different
   `datasetHash`, different `sourceWindow`) can still share individual
   `candidateId`/`candidateSetId` rows when their source windows overlap
   (Codex's own export tool re-scans a rolling window). Summing
   `rowCounts` across even DEDUPLICATED snapshots therefore still
   over-counts; the real unique N is the count of distinct row identities
   across every deduplicated snapshot, not the sum of per-snapshot counts.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple
from research.production_export_loader import canonical_json, sha256_hex


@dataclass(frozen=True)
class HistoricalExportEntry:
    directory_path: str
    manifest_text: str  # exact raw bytes/text of manifest.json, read as-is -- never re-serialized before hashing
    dataset: Dict[str, Any]  # parsed dataset.json


@dataclass(frozen=True)
class DedupeReport:
    raw_export_directory_count: int
    unique_manifest_hash_count: int
    unique_dataset_hash_count: int
    unique_candidate_set_count: int
    unique_candidate_count: int
    unique_execution_evidence_count: int
    duplicate_archive_copy_count: int
    representative_directories: Tuple[str, ...]  # one directory path per unique snapshot, for provenance
    identity_fallbacks_used: Tuple[str, ...]  # which entries had to fall back past manifest/dataset hash, and why


def _dataset_identity(entry: HistoricalExportEntry) -> Tuple[Optional[str], str]:
    """Returns (identity_key, fallback_note). fallback_note is '' when the
    strongest identity (manifest hash) was usable."""
    if entry.manifest_text:
        return sha256_hex(entry.manifest_text), ''
    dataset_hash = entry.dataset.get('datasetHash')
    if dataset_hash:
        return dataset_hash, f'{entry.directory_path}:FELL_BACK_TO_DATASET_HASH'
    window = entry.dataset.get('sourceWindow', {})
    feature_version = entry.dataset.get('featureSetVersion')
    if window.get('start') and window.get('end') and feature_version:
        key = canonical_json({'sourceWindow': window, 'featureSetVersion': feature_version})
        return sha256_hex(key), f'{entry.directory_path}:FELL_BACK_TO_SOURCE_WINDOW'
    return None, f'{entry.directory_path}:NO_USABLE_IDENTITY'


def deduplicate_historical_exports(entries: Sequence[HistoricalExportEntry]) -> DedupeReport:
    if not entries:
        return DedupeReport(0, 0, 0, 0, 0, 0, 0, (), ())

    by_manifest_hash: Dict[str, HistoricalExportEntry] = {}
    fallback_notes = []
    unidentifiable = []
    for entry in entries:
        key, note = _dataset_identity(entry)
        if note:
            fallback_notes.append(note)
        if key is None:
            unidentifiable.append(entry.directory_path)
            continue
        by_manifest_hash.setdefault(key, entry)  # first-seen representative only

    dataset_hashes = set()
    unique_candidate_sets = set()
    unique_candidates = set()
    unique_execution_evidence = set()
    for entry in by_manifest_hash.values():
        dataset_hashes.add(entry.dataset.get('datasetHash'))
        rows = entry.dataset.get('rows', {})
        for row in rows.get('candidateSets', []):
            unique_candidate_sets.add(row.get('candidateSetId'))
        for row in rows.get('candidates', []):
            unique_candidates.add(row.get('candidateId'))
        for row in rows.get('executionEvidence', []):
            unique_execution_evidence.add(row.get('quoteObservationId'))

    raw_count = len(entries)
    unique_count = len(by_manifest_hash)
    return DedupeReport(
        raw_export_directory_count=raw_count,
        unique_manifest_hash_count=unique_count,
        unique_dataset_hash_count=len(dataset_hashes),
        unique_candidate_set_count=len(unique_candidate_sets),
        unique_candidate_count=len(unique_candidates),
        unique_execution_evidence_count=len(unique_execution_evidence),
        duplicate_archive_copy_count=raw_count - unique_count - len(unidentifiable),
        representative_directories=tuple(sorted(e.directory_path for e in by_manifest_hash.values())),
        identity_fallbacks_used=tuple(fallback_notes),
    )
