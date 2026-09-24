"""Canonical export -> one row per evidenced economic chain.

This materializer joins explicit chain identities only. It never constructs
an economic chain from a candidate scan or recomputes accounting from option P&L.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from research.production_export_loader import LoadedDatasetExport, canonical_json, sha256_hex


def _time(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('CHAIN_DATASET_TIMESTAMP_TIMEZONE_REQUIRED')
    return result


def build_whole_chain_dataset(export: LoadedDatasetExport):
    if not export.hash_verified:
        raise ValueError('CHAIN_DATASET_REQUIRES_VERIFIED_EXPORT')
    chains = {}

    def chain(identity):
        if not isinstance(identity, str) or not identity.strip():
            raise ValueError('CHAIN_DATASET_IDENTITY_REQUIRED')
        return chains.setdefault(identity, {'management': [], 'lifecycle': [], 'labels': [], 'entryLinks': []})

    for link in export.entry_chain_links:
        chain(link['chainId'])['entryLinks'].append(link)

    unlinked_management = []
    for row in export.management_snapshots:
        if row.chain_id is None:
            unlinked_management.append(row.management_input_snapshot_id)
        else:
            chain(row.chain_id)['management'].append(row)
    for row in export.lifecycle_outcomes:
        chain(row.chain_id)['lifecycle'].append(row)
    # Managed-episode subjects are not assumed to share their identity with the
    # encompassing chain. They need an explicit linkage before joining here.
    unlinked_episode_labels = []
    for row in export.whole_chain_outcomes:
        if row.subject_type.value == 'WHOLE_CHAIN':
            chain(row.subject_id)['labels'].append(row)
        else:
            unlinked_episode_labels.append(row.outcome_label_id)

    rows = []
    for identity, data in sorted(chains.items()):
        entry_links = sorted(data['entryLinks'], key=lambda r: r['optionLegId'])
        entry_candidates = sorted({r['candidateId'] for r in entry_links})
        entry_state = 'EXPLICIT_ENTRY_CHAIN_JOIN_REQUIRED' if not entry_links else \
            'AMBIGUOUS_MULTIPLE_ENTRY_CANDIDATES' if len(entry_candidates) != 1 else 'EXPLICIT_LEDGER_JOIN'
        snapshots = sorted(data['management'], key=lambda r: (_time(r.observed_at), r.management_input_snapshot_id))
        lifecycle = sorted(data['lifecycle'], key=lambda r: (_time(r.applied_at), r.lifecycle_application_id))
        labels = sorted(data['labels'], key=lambda r: (_time(r.label_available_at), r.outcome_label_id))
        times = [r.observed_at for r in snapshots] + [r.applied_at for r in lifecycle]
        # This is first evidence in the exported window, not an invented entry
        # date. A truncated window never becomes a complete whole-chain path.
        first_observed = min(times, key=_time) if times else None
        last_observed = max(times, key=_time) if times else None
        state = 'RIGHT_CENSORED_NO_LABEL'
        selected = None
        if len(labels) > 1:
            state = 'LABEL_REVISION_REQUIRES_EXPLICIT_SELECTION'
        elif labels:
            label = labels[0]
            if _time(label.label_available_at) > _time(export.exported_at):
                raise ValueError('CHAIN_LABEL_AFTER_EXPORT')
            if first_observed is not None and _time(label.label_available_at) < _time(first_observed):
                state = 'LABEL_PREDATES_EXPORTED_PATH'
            elif label.censoring_state.value == 'RESOLVED' and label.whole_chain_net_pnl is not None:
                state = 'RESOLVED_EXPORTED_LABEL'
                selected = label
            else:
                state = label.censoring_state.value
        rows.append({'economicChainId': identity, 'firstObservedInWindow': first_observed,
            'lastObservedInWindow': last_observed, 'pathCoverage': 'BOUNDED_EXPORT_WINDOW',
            'outcomeState': state, 'wholeChainAfterCostPnl': selected.whole_chain_net_pnl if selected else None,
            'labelAvailableAt': selected.label_available_at if selected else None,
            'selectedOutcomeLabelId': selected.outcome_label_id if selected else None,
            'managementSnapshots': [asdict(r) for r in snapshots],
            'lifecycleEvents': [asdict(r) for r in lifecycle],
            'outcomeLabels': [asdict(r) for r in labels],
            'entryCandidateIds': entry_candidates if entry_links else None,
            'entryLinkageState': entry_state, 'entryLinks': entry_links,
            'entryJoinAvailableAt': max((r['linkObservedAt'] for r in entry_links), key=_time) if entry_links else None,
            'trainingEligibility': 'NOT_ASSESSED', 'brokerAuthority': False})
    # Convert enums using the existing export serializer's canonical convention.
    def plain(value):
        if hasattr(value, 'value'):
            return value.value
        if isinstance(value, dict):
            return {k: plain(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [plain(v) for v in value]
        return value

    payload = plain({'version': 'theta-whole-chain-episode-dataset-v2', 'datasetHash': export.dataset_hash,
        'sourceWindow': {'start': export.source_window_start, 'end': export.source_window_end},
        'rows': rows, 'rowCount': len(rows), 'unlinkedManagementIds': sorted(unlinked_management),
        'unlinkedManagedEpisodeLabelIds': sorted(unlinked_episode_labels),
        'candidateRowsNotInferredAsEpisodes': len(export.candidates), 'brokerAuthority': False})
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
