"""PIT management-decision rows -> future whole-chain outcome kept separate
(work package 48).

Reuses `whole_chain_dataset.py`'s existing chain-join/label-selection
authority instead of re-deriving it: each row here is one already-observed
`ManagementSnapshot` (current position/option state, chain-to-date valid
actions, costs, risk already computed by Production and exported verbatim
in `input_fields`/`actions`), and the SAME chain's eventual matured label
(if any) is attached under a clearly separate `futureOutcome` key that a
consumer must not read as of the snapshot's own `observedAt`.
"""
from __future__ import annotations

from datetime import datetime
from research.production_export_loader import LoadedDatasetExport, canonical_json, sha256_hex
from research.whole_chain_dataset import build_whole_chain_dataset
from research.dataset_readiness import DependenceGroupKey, build_dependence_groups


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('MANAGEMENT_DATASET_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


def build_management_dataset(export: LoadedDatasetExport, policy: dict):
    if policy.get('version') != 'theta-management-dataset-policy-v1' or not policy.get('policyId'):
        raise ValueError('MANAGEMENT_DATASET_POLICY_REQUIRED')
    if policy.get('evidenceClass') not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('MANAGEMENT_DATASET_EVIDENCE_CLASS_REQUIRED')

    chains = build_whole_chain_dataset(export)
    rows, excluded = [], []
    for chain_row in chains['rows']:
        chain_id = chain_row['economicChainId']
        has_matured_label = chain_row['outcomeState'] == 'RESOLVED_EXPORTED_LABEL'
        future_outcome = {
            'state': chain_row['outcomeState'],
            'wholeChainAfterCostPnl': chain_row['wholeChainAfterCostPnl'] if has_matured_label else None,
            'labelAvailableAt': chain_row['labelAvailableAt'] if has_matured_label else None,
            'selectedOutcomeLabelId': chain_row['selectedOutcomeLabelId'] if has_matured_label else None,
        }
        for snapshot in chain_row['managementSnapshots']:
            reasons = []
            observed_at = snapshot.get('observed_at')
            if not isinstance(observed_at, str):
                reasons.append('MANAGEMENT_SNAPSHOT_OBSERVED_AT_MISSING')
            actions = snapshot.get('actions') or ()
            if not any(a['feasible'] for a in actions):
                reasons.append('MANAGEMENT_SNAPSHOT_NO_FEASIBLE_ACTIONS')
            if reasons:
                excluded.append({'managementInputSnapshotId': snapshot.get('management_input_snapshot_id'), 'reasons': sorted(set(reasons))})
                continue
            # This snapshot's own T0 fields only -- the chain's eventual label
            # (above) must never be read as available at this observedAt.
            rows.append({
                'observationId': snapshot['management_input_snapshot_id'],
                'economicChainId': chain_id,
                'fusionSnapshotId': snapshot['fusion_snapshot_id'],
                'observedAt': observed_at,
                'lifecycleState': snapshot.get('lifecycle_state'),
                'inputFields': snapshot.get('input_fields') or {},
                'unknownFields': list(snapshot.get('unknown_fields') or ()),
                'feasibleActions': list(actions),
                'selectedAction': snapshot.get('selected_action'),
                'secondBestAction': snapshot.get('second_best_action'),
                'decisionState': snapshot.get('decision_state'),
                'reasonCodes': list(snapshot.get('reason_codes') or ()),
                'contentHash': snapshot.get('content_hash'),
                'futureOutcome': future_outcome,
            })
    rows.sort(key=lambda r: (_time(r['observedAt']), r['observationId']))
    keys = [DependenceGroupKey(r['economicChainId'], r['economicChainId'], None,
            _time(r['observedAt']).date().isoformat(), None) for r in rows]
    groups = build_dependence_groups(keys)
    for group, members in groups.items():
        for index in members:
            rows[index]['dependencyGroupId'] = group
    payload = {
        'version': 'theta-management-dataset-v1', 'datasetHash': export.dataset_hash,
        'chainDatasetHash': chains['contentHash'], 'policy': policy,
        'policyHash': sha256_hex(canonical_json(policy)), 'evidenceClass': policy['evidenceClass'],
        'rows': rows, 'excluded': excluded, 'rowCount': len(rows),
        'dependencyComponentCount': len(groups), 'brokerAuthority': False,
        'state': 'ROWS_JOINED_NOT_MODEL_QUALIFIED' if rows else 'NO_ELIGIBLE_MANAGEMENT_SNAPSHOTS',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
