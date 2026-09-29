"""Reproducibility bundle: everything needed to reproduce one experiment's
result byte-for-byte (work package 66).

Every module built this session already emits a `contentHash`
(`production_export_loader.py`'s canonical-JSON/SHA-256 convention) on its
own payload -- this module does not add a second hashing authority. It
only assembles the cross-cutting identity fields (source SHA, dataset/
config hashes, feature/label/model versions, split hash, seed, experiment
ID, metric hash) that a caller must already have on hand into one frozen,
hashed, round-trippable bundle, and verifies a rebuilt bundle matches.
"""
from __future__ import annotations

from research.production_export_loader import canonical_json, sha256_hex

_REQUIRED_FIELDS = (
    'sourceSha', 'datasetHash', 'configHash', 'featureVersion', 'labelVersion',
    'modelVersion', 'splitHash', 'seed', 'experimentId', 'metricHash',
)


def build_reproducibility_bundle(**fields: object) -> dict:
    missing = [name for name in _REQUIRED_FIELDS if fields.get(name) in (None, '')]
    if missing:
        raise ValueError(f'REPRODUCIBILITY_BUNDLE_FIELD_REQUIRED:{missing[0]}')
    if type(fields['seed']) is not int:
        raise ValueError('REPRODUCIBILITY_BUNDLE_SEED_MUST_BE_INT')
    unexpected = [key for key in fields if key not in _REQUIRED_FIELDS]
    if unexpected:
        raise ValueError(f'REPRODUCIBILITY_BUNDLE_UNEXPECTED_FIELD:{unexpected[0]}')
    payload = {'version': 'theta-reproducibility-bundle-v1', **{name: fields[name] for name in _REQUIRED_FIELDS}}
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


def verify_reproducibility_bundle(bundle: dict) -> bool:
    """Rebuilds the bundle from its own declared fields and confirms the
    hash matches -- catches a bundle that was hand-edited after the fact."""
    fields = {name: bundle.get(name) for name in _REQUIRED_FIELDS}
    rebuilt = build_reproducibility_bundle(**fields)
    return rebuilt['contentHash'] == bundle.get('contentHash')
