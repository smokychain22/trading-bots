// The Phase 4 archive candidate populations. Every population is Tier C (historical research payloads whose only copy is the database row) or Tier D.
// Tier A (orders, fills, reconciliation, execution attempts, action plans, lifecycle, inventory, accounting, risk, policy lineage) is never listed here.
import type { ArchivePopulation } from './storage-archive-lib.js';

/** Rows older than this are the pre-bounded-storage "legacy" evidence of 2026-09-16..2026-09-25 (the bounded cycle-archive contract began 2026-09-29). */
export const defaultLegacyCutoff = '2026-09-26T04:00:00Z';

export const archivePopulations: readonly ArchivePopulation[] = [
  {
    id: 'legacy-candidate-point-in-time-evidence', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'trade', table: 'candidate_point_in_time_evidence',
    keyColumn: 'candidate_id', timeColumn: 'decision_time', where: 't.decision_time < $1', purgeAction: 'DELETE_ROWS',
    payloadColumns: ['volatility_json', 'event_json', 'provider_provenance_json', 'portfolio_json', 'flow_json', 'market_json', 'contract_json'], pageRows: 300,
    rationale: 'per-candidate point-in-time evidence written before the bounded cycle contract; shared context (event, provenance, portfolio, flow, account) is repeated once per candidate',
  },
  {
    id: 'legacy-canonical-strategy-candidate-evidence', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'trade', table: 'canonical_strategy_candidate_evidence',
    keyColumn: 'candidate_evidence_id', timeColumn: 'created_at', where: 't.created_at < $1', purgeAction: 'DELETE_ROWS',
    payloadColumns: ['legs_json', 'economics_json', 'unknown_evidence_json', 'sizing_reasons_json'], pageRows: 1500,
    rationale: 'per-candidate relational copies of frontier candidates; the bounded contract keeps the complete candidate list inside the compressed cycle archive instead',
  },
  {
    id: 'legacy-fusion-snapshot-payload', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'trade', table: 'fusion_snapshot',
    keyColumn: 'fusion_snapshot_id', timeColumn: 'decision_time', where: 't.decision_time < $1 AND t.storage_contract_version IS NULL', purgeAction: 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER',
    payloadColumns: ['snapshot_json'], pageRows: 6,
    rationale: 'pre-contract full snapshots (about 0.8 MiB each); the row, ids and content hash stay as lineage, only the bulky payload would be replaced by an archive pointer',
  },
  {
    id: 'legacy-optionomics-feature-snapshot', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'market', table: 'optionomics_feature_snapshot',
    keyColumn: 'feature_snapshot_id', timeColumn: 'observed_at', where: 't.observed_at < $1', purgeAction: 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER',
    payloadColumns: ['feature_state_json'], pageRows: 20,
    rationale: 'Optionomics derived feature state; also embedded in the legacy fusion snapshot payload',
  },
  {
    id: 'legacy-option-chain-decision-evidence', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'research', table: 'theta_option_chain_decision_evidence',
    keyColumn: 'chain_decision_evidence_id', timeColumn: 'observed_at', where: 't.observed_at < $1', purgeAction: 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER',
    payloadColumns: ['structure_comparator_json', 'optionomics_attachments_json', 'chain_snapshot_json'], pageRows: 20,
    rationale: 'research-only chain comparison evidence for the legacy sessions',
  },
  {
    id: 'legacy-optionomics-raw-observation', tier: 'TIER_C_RESEARCH_ARCHIVABLE', schema: 'market', table: 'optionomics_raw_observation',
    keyColumn: 'observation_id', timeColumn: 'created_at', where: 't.created_at < $1', purgeAction: 'REPLACE_PAYLOAD_WITH_ARCHIVE_POINTER',
    payloadColumns: ['payload_json'], pageRows: 200,
    rationale: 'raw provider payloads (not re-fetchable as they were at the time); archived byte-exact before any purge',
  },
];
