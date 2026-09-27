"""Research-only, versioned v1->v6 historical export compatibility bridge.

Git-history evidence (commits f9dff66 through fa7e589 in
`src/research/point-in-time-evidence.ts`, one commit per `datasetExportVersion`
bump) proves the v1->v6 evolution is PURELY ADDITIVE at the row-family
level: each version adds a new, previously-absent top-level row collection
(`optionChainDecisions` at v3; `outcomeSubjects`/`outcomeObservations`/
`outcomeResolutionReceipts`/`resolvedOutcomeLabels` at v4;
`policyLearningRecords` at v5; `positionPathCheckpoints`/
`actionInactionFrontiers`/`strategyTimingSnapshots` at v6). No field inside
`candidateSets`/`candidates`/`shadowCandidates`/`strategyFrontiers`/
`managementSnapshots`/`lifecycleOutcomes`/`wholeChainOutcomes`/
`executionEvidence` was renamed, removed, or had its semantics changed
across this range -- the one semantic change found (v1->v2) was a
validation-rule allowlist addition for `wholechainpnl` inside
`managementSnapshots`, irrelevant here since every archived export has
`managementSnapshots: []`. `production_export_loader.py`'s own
`load_dataset_export()` already reads every v6-only family via
`rows_raw.get(name, [])`, so an ABSENT v6-only key was already tolerated;
the only real blocker to loading an older archive was the hard
`schema_version != DATASET_SCHEMA_VERSION` equality gate.

**Hash verification limitation, found and documented, not silently
skipped**: this module attempted to reproduce the archived files'
declared `datasetHash` using the exact documented formula (from both the
v1-era and v6-era `buildDatasetExport()` source: `sha256(canonicalJson({
schemaVersion, sourceWindow, featureSetVersion, strategyVersions (sorted+
deduped), rows, rowCounts }))`, `exportedAt` excluded from identity from
v6 onward) against real files under `C:\\ProjectBackups\\trading-bots\\`.
The recomputed hash did NOT match the declared hash for the files
inspected, under either the v1-era or v6-era formula. This module
therefore NEVER claims a converted historical export is hash-verified; it
records `source_hash_verified=False` explicitly and always, and a
consumer must treat every row here as `truth_class=MODELED_RESEARCH`-tier
provenance at best (never `BROKER_ACTUAL`, never promoted to
"Production-signed") until/unless the discrepancy is independently
resolved by Codex (who owns the export tooling and the backup pipeline
that may have reformatted these files after the original write).

This module does not mutate the originals -- it only reads them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from research.production_export_loader import (
    DatasetLoadError, _assert_deterministic_order, _assert_unique_ids,
    _load_candidate, _load_candidate_set, _load_execution_evidence,
    _load_lifecycle_event, _load_management_snapshot, _load_economic_episode,
    _load_shadow_candidate, canonical_json, sha256_hex,
)
from research.production_export_loader import DATASET_SCHEMA_VERSION

CONVERTER_VERSION = 'theta-historical-v1-to-v6-bridge-v1'

# Each entry: schema version -> the row families first introduced AT that
# version (never present in an earlier one), per the git-history evidence
# in this module's own docstring.
KNOWN_LINEAGE_INTRODUCED_AT = {
    'theta-r6-dataset-v1': ('candidateSets', 'candidates', 'shadowCandidates', 'strategyFrontiers',
                            'managementSnapshots', 'lifecycleOutcomes', 'wholeChainOutcomes', 'executionEvidence'),
    'theta-r6-dataset-v2': (),  # validation-rule-only change, no new row family
    'theta-r6-dataset-v3': ('optionChainDecisions',),
    'theta-r6-dataset-v4': ('outcomeSubjects', 'outcomeObservations', 'outcomeResolutionReceipts', 'resolvedOutcomeLabels'),
    'theta-r6-dataset-v5': ('policyLearningRecords',),
    'theta-r6-dataset-v6': ('positionPathCheckpoints', 'actionInactionFrontiers', 'strategyTimingSnapshots'),
}
KNOWN_LINEAGE_VERSIONS = tuple(KNOWN_LINEAGE_INTRODUCED_AT)


def _families_available_at(schema_version: str) -> Tuple[str, ...]:
    index = KNOWN_LINEAGE_VERSIONS.index(schema_version)
    available: List[str] = []
    for version in KNOWN_LINEAGE_VERSIONS[: index + 1]:
        available.extend(KNOWN_LINEAGE_INTRODUCED_AT[version])
    return tuple(available)


@dataclass(frozen=True)
class HistoricalConversionResult:
    converter_version: str
    source_schema_version: str
    target_schema_version: str
    source_dataset_hash: str
    recomputed_hash_under_source_schema: str
    source_hash_verified: bool
    candidate_sets: List[Any]
    candidates: List[Any]
    shadow_candidates: List[Any]
    strategy_frontiers: List[Dict[str, Any]]
    management_snapshots: List[Any]
    lifecycle_outcomes: List[Any]
    whole_chain_outcomes: List[Any]
    execution_evidence: List[Any]
    unavailable_fields: Tuple[str, ...]  # v6-only families absent from this source schema version -- never fabricated as empty-but-verified
    converted_content_hash: str = field(default='')


def convert_historical_export(raw: Dict[str, Any]) -> HistoricalConversionResult:
    schema_version = raw.get('schemaVersion')
    if schema_version not in KNOWN_LINEAGE_VERSIONS:
        raise DatasetLoadError(f'HISTORICAL_BRIDGE_UNKNOWN_SCHEMA_VERSION:{schema_version}')

    rows_raw = raw.get('rows', {})
    for row_family in KNOWN_LINEAGE_VERSIONS[: KNOWN_LINEAGE_VERSIONS.index(schema_version) + 1]:
        for family in KNOWN_LINEAGE_INTRODUCED_AT[row_family]:
            _assert_deterministic_order(rows_raw.get(family, []), canonical_json)

    candidate_sets = [_load_candidate_set(r) for r in rows_raw.get('candidateSets', [])]
    candidates = [_load_candidate(r) for r in rows_raw.get('candidates', [])]
    shadow_candidates = [_load_shadow_candidate(r) for r in rows_raw.get('shadowCandidates', [])]
    strategy_frontiers = list(rows_raw.get('strategyFrontiers', []))
    management_snapshots = [_load_management_snapshot(r) for r in rows_raw.get('managementSnapshots', [])]
    lifecycle_outcomes = [_load_lifecycle_event(r) for r in rows_raw.get('lifecycleOutcomes', [])]
    whole_chain_outcomes = [_load_economic_episode(r) for r in rows_raw.get('wholeChainOutcomes', [])]
    execution_evidence = [_load_execution_evidence(r) for r in rows_raw.get('executionEvidence', [])]

    _assert_unique_ids(candidate_sets, lambda c: c.candidate_set_id, 'candidate_set')
    _assert_unique_ids(candidates, lambda c: c.candidate_id, 'candidate')
    _assert_unique_ids(execution_evidence, lambda e: e.quote_observation_id, 'execution_evidence')
    _assert_unique_ids(whole_chain_outcomes, lambda e: e.outcome_label_id, 'economic_episode')
    all_candidate_ids = {c.candidate_id for c in candidates}
    for candidate_set in candidate_sets:
        for field_name, cid in (('best', candidate_set.best_candidate_id),
                                 ('second_best', candidate_set.second_best_candidate_id),
                                 ('best_rejected', candidate_set.best_rejected_candidate_id)):
            if cid is not None and cid not in all_candidate_ids:
                raise DatasetLoadError(f'HISTORICAL_BRIDGE_CANDIDATE_SET_REFERENCES_UNKNOWN_CANDIDATE:{candidate_set.candidate_set_id}:{field_name}={cid}')

    identity = {
        'schemaVersion': schema_version, 'sourceWindow': raw['sourceWindow'],
        'featureSetVersion': raw['featureSetVersion'],
        'strategyVersions': sorted(set(raw.get('strategyVersions', []))),
        'rows': rows_raw, 'rowCounts': raw.get('rowCounts', {k: len(v) for k, v in rows_raw.items()}),
    }
    recomputed = sha256_hex(canonical_json(identity))
    declared = raw.get('datasetHash', '')
    source_hash_verified = recomputed == declared

    all_known_families = set()
    for families in KNOWN_LINEAGE_INTRODUCED_AT.values():
        all_known_families.update(families)
    available_here = set(_families_available_at(schema_version))
    unavailable = tuple(sorted(all_known_families - available_here))

    result = HistoricalConversionResult(
        converter_version=CONVERTER_VERSION, source_schema_version=schema_version,
        target_schema_version=DATASET_SCHEMA_VERSION, source_dataset_hash=declared,
        recomputed_hash_under_source_schema=recomputed, source_hash_verified=source_hash_verified,
        candidate_sets=candidate_sets, candidates=candidates, shadow_candidates=shadow_candidates,
        strategy_frontiers=strategy_frontiers, management_snapshots=management_snapshots,
        lifecycle_outcomes=lifecycle_outcomes, whole_chain_outcomes=whole_chain_outcomes,
        execution_evidence=execution_evidence, unavailable_fields=unavailable,
    )
    converted_hash = sha256_hex(canonical_json({
        'converterVersion': result.converter_version, 'sourceSchemaVersion': result.source_schema_version,
        'sourceDatasetHash': result.source_dataset_hash, 'sourceHashVerified': result.source_hash_verified,
        'candidateIds': sorted(c.candidate_id for c in candidates),
        'candidateSetIds': sorted(c.candidate_set_id for c in candidate_sets),
        'executionEvidenceIds': sorted(e.quote_observation_id for e in execution_evidence),
        'unavailableFields': list(unavailable),
    }))
    return HistoricalConversionResult(**{**result.__dict__, 'converted_content_hash': converted_hash})
