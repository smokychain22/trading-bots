"""Executable missingness report by feature/field/date/strategy/schema/
provider/truth/reason (work package 73).

Operates on a generic sequence of flat "field observation" records so it
runs identically on v6 rows and on `historical_v1_to_v6_bridge.py`'s
converted v1 rows -- the caller flattens whatever row shape it has into
records of `{dimension_key: value, ..., value_key: <the observed value or
None>}`; this module never assumes a specific dataset schema.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

DIMENSIONS = ('feature', 'field', 'date', 'strategy', 'schemaVersion', 'provider', 'truthClass', 'reasonCode')


def build_missingness_report(
    records: Sequence[Dict[str, Any]], value_key: str, dimensions: Optional[Sequence[str]] = None,
) -> dict:
    dims = tuple(dimensions) if dimensions is not None else DIMENSIONS
    unknown = [d for d in dims if d not in DIMENSIONS]
    if unknown:
        raise ValueError(f'MISSINGNESS_ENGINE_UNKNOWN_DIMENSION:{unknown[0]}')
    if not dims:
        raise ValueError('MISSINGNESS_ENGINE_NO_DIMENSIONS_REQUESTED')

    by_dimension: Dict[str, Dict[str, Dict[str, int]]] = {d: {} for d in dims}
    total = len(records)
    missing_total = 0
    for record in records:
        is_missing = record.get(value_key) is None
        if is_missing:
            missing_total += 1
        for dim in dims:
            key = record.get(dim)
            key_str = str(key) if key is not None else 'UNKNOWN_DIMENSION_VALUE'
            bucket = by_dimension[dim].setdefault(key_str, {'present': 0, 'missing': 0})
            bucket['missing' if is_missing else 'present'] += 1

    return {
        'version': 'theta-missingness-engine-v1', 'valueKey': value_key, 'dimensionsReported': list(dims),
        'totalRecords': total, 'missingTotal': missing_total,
        'missingFraction': (missing_total / total) if total else None,
        'byDimension': by_dimension,
    }
