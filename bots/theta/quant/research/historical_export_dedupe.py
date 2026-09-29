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
from typing import Any, Callable, Dict, Optional, Sequence, Tuple
from research.production_export_loader import canonical_json, sha256_hex


@dataclass(frozen=True)
class HistoricalExportEntry:
    directory_path: str
    manifest_text: str  # exact raw bytes/text of manifest.json, read as-is -- never re-serialized before hashing
    dataset: Dict[str, Any]  # parsed dataset.json


@dataclass(frozen=True)
class LazyHistoricalExportEntry:
    """Work package 84: the caller supplies only the CHEAP manifest text
    up front, plus a thunk that parses the (potentially large)
    dataset.json on demand. `deduplicate_historical_exports_lazy` never
    calls `load_dataset` for an entry whose manifest hash it has already
    seen -- a known duplicate's dataset.json is never even read, let alone
    parsed, avoiding the full-backup-copy-load anti-pattern."""
    directory_path: str
    manifest_text: str
    load_dataset: Callable[[], Dict[str, Any]]


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


def _tally(dataset: Dict[str, Any], dataset_hashes: set, candidate_sets: set, candidates: set, execution_evidence: set) -> None:
    dataset_hashes.add(dataset.get('datasetHash'))
    rows = dataset.get('rows', {})
    for row in rows.get('candidateSets', []):
        candidate_sets.add(row.get('candidateSetId'))
    for row in rows.get('candidates', []):
        candidates.add(row.get('candidateId'))
    for row in rows.get('executionEvidence', []):
        execution_evidence.add(row.get('quoteObservationId'))


def deduplicate_historical_exports_lazy(entries: Sequence[LazyHistoricalExportEntry]) -> DedupeReport:
    if not entries:
        return DedupeReport(0, 0, 0, 0, 0, 0, 0, (), ())

    seen_manifest_hashes: Dict[str, str] = {}  # manifest_hash -> representative directory_path
    fallback_notes = []
    unidentifiable = []
    dataset_hashes, candidate_sets, candidates, execution_evidence = set(), set(), set(), set()

    for entry in entries:
        if entry.manifest_text:
            key = sha256_hex(entry.manifest_text)
        else:
            # Cannot determine identity from the cheap manifest alone --
            # this is the one case that must fall back to reading the
            # full dataset, exactly as documented on the dataclass.
            dataset = entry.load_dataset()
            dataset_hash = dataset.get('datasetHash')
            if dataset_hash:
                key = dataset_hash
                fallback_notes.append(f'{entry.directory_path}:FELL_BACK_TO_DATASET_HASH')
            else:
                window = dataset.get('sourceWindow', {})
                feature_version = dataset.get('featureSetVersion')
                if window.get('start') and window.get('end') and feature_version:
                    key = sha256_hex(canonical_json({'sourceWindow': window, 'featureSetVersion': feature_version}))
                    fallback_notes.append(f'{entry.directory_path}:FELL_BACK_TO_SOURCE_WINDOW')
                else:
                    unidentifiable.append(entry.directory_path)
                    continue
            if key not in seen_manifest_hashes:
                seen_manifest_hashes[key] = entry.directory_path
                _tally(dataset, dataset_hashes, candidate_sets, candidates, execution_evidence)
            continue

        if key in seen_manifest_hashes:
            continue  # known duplicate -- load_dataset() is NEVER called for it
        seen_manifest_hashes[key] = entry.directory_path
        _tally(entry.load_dataset(), dataset_hashes, candidate_sets, candidates, execution_evidence)

    raw_count = len(entries)
    unique_count = len(seen_manifest_hashes)
    return DedupeReport(
        raw_export_directory_count=raw_count, unique_manifest_hash_count=unique_count,
        unique_dataset_hash_count=len(dataset_hashes), unique_candidate_set_count=len(candidate_sets),
        unique_candidate_count=len(candidates), unique_execution_evidence_count=len(execution_evidence),
        duplicate_archive_copy_count=raw_count - unique_count - len(unidentifiable),
        representative_directories=tuple(sorted(seen_manifest_hashes.values())),
        identity_fallbacks_used=tuple(fallback_notes),
    )


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
