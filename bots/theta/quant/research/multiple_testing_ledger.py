"""Link experiment-registry trial count to selection-bias reporting (WP63).

`experiment_registry.py`'s `EXPERIMENTS_BY_ID` is the real, canonical set of
defined trials; `selection_bias_runner.py`'s `run_selection_bias_campaign`
already computes DSR/PBO from a caller-supplied `trialIdentities` list, but
nothing previously derived that list FROM the registry -- a caller could
under-count the real search space by hand-picking which trials "count."
This module closes that gap by validating a considered trial-id set against
the real registry (rejecting an unregistered id outright, never silently
dropping it) and building the multiple-testing manifest that documents
exactly which trials were in scope for a given selection-bias run.
"""
from __future__ import annotations

from typing import Dict, Sequence, Tuple
from research.experiment_registry import EXPERIMENT_REGISTRY_VERSION, EXPERIMENTS_BY_ID
from research.production_export_loader import canonical_json, sha256_hex


def build_multiple_testing_ledger(considered_experiment_ids: Sequence[str], subject_experiment_id: str) -> dict:
    if not considered_experiment_ids:
        raise ValueError('MULTIPLE_TESTING_LEDGER_EMPTY_TRIAL_SET')
    if len(set(considered_experiment_ids)) != len(considered_experiment_ids):
        raise ValueError('MULTIPLE_TESTING_LEDGER_DUPLICATE_TRIAL_ID')
    unregistered = [i for i in considered_experiment_ids if i not in EXPERIMENTS_BY_ID]
    if unregistered:
        raise ValueError(f'MULTIPLE_TESTING_LEDGER_UNREGISTERED_TRIAL_ID:{sorted(unregistered)[0]}')
    if subject_experiment_id not in considered_experiment_ids:
        raise ValueError('MULTIPLE_TESTING_LEDGER_SUBJECT_MUST_BE_IN_CONSIDERED_SET')
    # Subject first (selection_bias_runner.py's own convention: "the subject
    # trial is always the first identity"), the rest sorted for determinism.
    ordered = (subject_experiment_id, *sorted(i for i in considered_experiment_ids if i != subject_experiment_id))
    payload = {
        'version': 'theta-multiple-testing-ledger-v1',
        'registryVersion': EXPERIMENT_REGISTRY_VERSION,
        'subjectExperimentId': subject_experiment_id,
        'trialIdentities': list(ordered),
        'trialCount': len(ordered),
        'considerationScope': 'CALLER_DECLARED_NOT_ALL_REGISTERED_EXPERIMENTS',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


def trial_identities_for_selection_bias(ledger: dict) -> Tuple[str, ...]:
    if not ledger.get('trialIdentities'):
        raise ValueError('MULTIPLE_TESTING_LEDGER_NOT_FROZEN')
    return tuple(ledger['trialIdentities'])
