"""Management checkpoint outcomes: T0 state/action, later market
observation, later broker lifecycle, and whole-chain outcome kept as four
explicitly separate fields (work package 70).

Composes over `management_dataset.py` (WP48, unchanged, not re-derived)
and `whole_chain_dataset.py`'s existing `lifecycleEvents` per chain. A
consumer must not fold `later_broker_lifecycle`/`whole_chain_outcome` into
the checkpoint's own T0 fields -- separate keys exist specifically so a
model-training path can select "T0 only" without an accidental future
leak, while an audit path can still see everything.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from research.production_export_loader import canonical_json, sha256_hex


@dataclass(frozen=True)
class ManagementCheckpointOutcome:
    observation_id: str
    economic_chain_id: str
    t0_state: Dict[str, Any]  # the management_dataset.py row's own T0 fields, passed through verbatim
    later_market_observation: Dict[str, Any]  # from horizon_adapters.py evidence when present; NOT_CAPTURED otherwise
    later_broker_lifecycle: Tuple[Dict[str, Any], ...]  # this chain's lifecycle_events, unmodified
    whole_chain_outcome: Dict[str, Any]  # the same futureOutcome management_dataset.py already computed
    content_hash: str = ''


_T0_KEYS = (
    'observationId', 'economicChainId', 'fusionSnapshotId', 'observedAt', 'lifecycleState', 'inputFields',
    'unknownFields', 'feasibleActions', 'selectedAction', 'secondBestAction', 'decisionState', 'reasonCodes',
    'contentHash', 'dependencyGroupId',
)


def build_management_checkpoint_outcome(
    management_row: Dict[str, Any], chain_lifecycle_events: List[Dict[str, Any]],
    later_market_observation: Optional[Dict[str, Any]] = None,
) -> ManagementCheckpointOutcome:
    missing = [key for key in ('observationId', 'economicChainId', 'futureOutcome') if key not in management_row]
    if missing:
        raise ValueError(f'MANAGEMENT_CHECKPOINT_FIELD_MISSING:{missing[0]}')
    t0_state = {key: management_row[key] for key in _T0_KEYS if key in management_row}
    market_observation = later_market_observation if later_market_observation is not None else {'state': 'NOT_CAPTURED_NO_HORIZON_DATA'}
    payload = dict(
        observation_id=management_row['observationId'], economic_chain_id=management_row['economicChainId'],
        t0_state=t0_state, later_market_observation=market_observation,
        later_broker_lifecycle=tuple(chain_lifecycle_events), whole_chain_outcome=management_row['futureOutcome'],
    )
    hashable = {**payload, 'later_broker_lifecycle': list(payload['later_broker_lifecycle'])}
    return ManagementCheckpointOutcome(**payload, content_hash=sha256_hex(canonical_json(hashable)))
