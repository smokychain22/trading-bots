"""Source data validation report (work package 72).

A non-fatal, structured REPORT over an export's raw JSON -- distinct from
`production_export_loader.py`/`historical_v1_to_v6_bridge.py`, which both
fail fast on the first structural violation (the right behavior for a
strict load path). This module runs every check independently and
collects every finding, so a caller auditing a suspect archive sees the
full picture in one pass instead of fixing one violation just to
discover the next.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List
from research.production_export_loader import canonical_json, sha256_hex
from research.historical_v1_to_v6_bridge import KNOWN_LINEAGE_VERSIONS


def _parse(value: Any):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo is not None else None
    except ValueError:
        return None


def validate_source_export(raw: Dict[str, Any], *, now: datetime) -> Dict[str, Any]:
    findings: List[str] = []

    schema_version = raw.get('schemaVersion')
    if schema_version not in KNOWN_LINEAGE_VERSIONS:
        findings.append(f'SCHEMA_VERSION_UNKNOWN:{schema_version}')

    rows_raw = raw.get('rows', {})
    identity = {
        'schemaVersion': schema_version, 'sourceWindow': raw.get('sourceWindow'),
        'featureSetVersion': raw.get('featureSetVersion'), 'strategyVersions': sorted(set(raw.get('strategyVersions', []))),
        'rows': rows_raw, 'rowCounts': raw.get('rowCounts', {}),
    }
    try:
        recomputed = sha256_hex(canonical_json(identity))
        declared = raw.get('datasetHash', '')
        if recomputed != declared:
            findings.append('DATASET_HASH_MISMATCH')
    except Exception:
        findings.append('DATASET_HASH_UNCOMPUTABLE')

    for family, rows in rows_raw.items():
        if not isinstance(rows, list):
            continue
        id_fields = ('candidateId', 'candidateSetId', 'quoteObservationId', 'managementInputSnapshotId', 'outcomeLabelId')
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            for id_field in id_fields:
                if id_field in row:
                    key = (family, id_field, row[id_field])
                    if key in seen:
                        findings.append(f'DUPLICATE_ROW_IDENTITY:{family}:{id_field}:{row[id_field]}')
                    seen.add(key)
            decision_time = row.get('decisionTime') or row.get('observedAt') or row.get('appliedAt')
            parsed = _parse(decision_time) if decision_time else None
            if parsed is not None and parsed > now:
                findings.append(f'FUTURE_TIMESTAMP:{family}:{decision_time}')
            contract = row.get('contract')
            if isinstance(contract, dict) and contract.get('multiplier') not in (None, 100):
                findings.append(f'UNEXPECTED_CONTRACT_MULTIPLIER:{family}:{contract.get("multiplier")}')

    exported_at = _parse(raw.get('exportedAt'))
    if raw.get('exportedAt') is not None and exported_at is None:
        findings.append('EXPORTED_AT_TIMEZONE_MISSING')
    if exported_at is not None and exported_at > now:
        findings.append('EXPORTED_AT_IN_FUTURE')

    source_window = raw.get('sourceWindow', {})
    start, end = _parse(source_window.get('start')), _parse(source_window.get('end'))
    if source_window.get('start') is not None and start is None:
        findings.append('SOURCE_WINDOW_START_TIMEZONE_MISSING')
    if start is not None and end is not None and end < start:
        findings.append('SOURCE_WINDOW_END_BEFORE_START')

    return {
        'version': 'theta-source-data-validation-v1', 'state': 'PASS' if not findings else 'FINDINGS_PRESENT',
        'findings': sorted(set(findings)),
    }
