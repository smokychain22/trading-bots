// THETA data platform: dataset lifecycle registry. One governed table says, for every dataset, WHY it is hot, HOW LONG it is hot, when it is archived, when it leaves
// PostgreSQL, what stays behind, and how it is restored. Windows are counted in TRADING SESSIONS (an idle weekend must not age data). Nothing here deletes anything:
// a dataset only leaves PostgreSQL after a verified archive (see partition-lifecycle.ts).
//
// Memory types: WORKING = PostgreSQL; LONG_TERM = columnar archive; REPRODUCIBILITY = GitHub (code, schema, manifests, receipts); DISASTER_RECOVERY = verified backups.

import type { WritePriority } from './storage-governor.js';

export type DatasetClass = 'OPERATIONAL_TRUTH' | 'AUDIT_LINEAGE' | 'RUNTIME_EVIDENCE' | 'RESEARCH_HISTORY' | 'RAW_PROVIDER_PAYLOAD';
export type PartitionGranularity = 'SESSION_DATE' | 'WEEK' | 'MONTH' | 'NONE';
export type ColdPolicy = 'NEVER_LEAVES_POSTGRES' | 'ARCHIVE_THEN_RETIRE_PARTITION' | 'COMPACT_THEN_ARCHIVE_DETAIL';
export type ReconstructionCost = 'LOW' | 'MEDIUM' | 'HIGH' | 'IRREPLACEABLE';
export type GrowthLifecycleClass = 'ACTIVE_OPERATIONAL_TRUTH' | 'BOUNDED_RECENT_WINDOW' | 'ARCHIVE_THEN_COMPACT' | 'AGGREGATE_THEN_ARCHIVE_RAW' | 'TRULY_TINY_PERMANENT_METADATA';

export interface DatasetValue {
  /** 0 (none) to 3 (essential) */
  readonly operational: 0 | 1 | 2 | 3;
  readonly audit: 0 | 1 | 2 | 3;
  readonly research: 0 | 1 | 2 | 3;
  readonly reconstructionCost: ReconstructionCost;
  readonly accessFrequency: 'EVERY_CYCLE' | 'DAILY' | 'WEEKLY' | 'RARE';
}

export interface DatasetPolicy {
  readonly id: string;
  readonly description: string;
  readonly tables: readonly string[];
  readonly datasetClass: DatasetClass;
  readonly growthLifecycleClass: GrowthLifecycleClass;
  /** what the StoragePressureGate may do with new writes of this dataset under pressure (operational truth is always P0 and never gated) */
  readonly writePriority: WritePriority;
  readonly partition: { readonly column: string | null; readonly granularity: PartitionGranularity };
  /** trading sessions kept in PostgreSQL after the session closes, or PERMANENT for operational truth */
  readonly hotSessions: number | 'PERMANENT';
  /** additional sessions the verified archive stays cached locally for fast replay/debugging (a local analytical cache, not PostgreSQL) */
  readonly warmSessions: number;
  readonly coldPolicy: ColdPolicy;
  /** what remains in PostgreSQL after the detail is retired */
  readonly compactHotForm: string;
  readonly whyHot: string;
  readonly whyWarm: string;
  readonly archiveWhen: string;
  readonly removeFromPostgresWhen: string;
  readonly restoredHow: string;
  readonly value: DatasetValue;
}

const SESSION = { granularity: 'SESSION_DATE' } as const;

export const datasetRegistry: readonly DatasetPolicy[] = [
  {
    id: 'cycle-evidence-blob', description: 'complete compressed cycle evidence (T0 input, full frontier, every candidate): the raw replay source of each decision',
    tables: ['dp.cycle_evidence_blob'], datasetClass: 'RUNTIME_EVIDENCE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P1_SELECTED_AND_FINALIST_EVIDENCE', partition: { column: 'session_date', ...SESSION }, hotSessions: 5, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'trade.fusion_snapshot keeps id, time, content hash, archive_id and archive content hash (about 1 KiB)',
    whyHot: 'recent replay, incident debugging and outcome-label resolution need the exact T0 within days of a decision', whyWarm: 'research replays of recent sessions are frequent; a local cache avoids repeated archive reads',
    archiveWhen: 'after the session closes and the partition is CLOSED_HOT', removeFromPostgresWhen: 'five sessions after close, only after the archive is hash-, row- and replay-verified (partition detach, then drop)',
    restoredHow: 'EvidenceReader resolves the archive manifest by archive content hash and returns the original compressed blob byte-for-byte; replayCycleArchive accepts it unchanged',
    value: { operational: 0, audit: 3, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'decision-context', description: 'shared per-decision context (account, portfolio, market/regime, event, provenance, ownership, AEGIS inputs, versions) stored once and referenced by candidates',
    tables: ['dp.decision_context'], datasetClass: 'RUNTIME_EVIDENCE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P1_SELECTED_AND_FINALIST_EVIDENCE', partition: { column: 'session_date', ...SESSION }, hotSessions: 10, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'decision audit row keeps the context content hash',
    whyHot: 'every hot candidate reference resolves through it', whyWarm: 'research joins candidates to context', archiveWhen: 'with the matching candidate partitions', removeFromPostgresWhen: 'after candidates of the same sessions are archived and verified',
    restoredHow: 'content hash lookup in the archive manifest', value: { operational: 1, audit: 3, research: 3, reconstructionCost: 'HIGH', accessFrequency: 'DAILY' },
  },
  {
    id: 'candidate-hot-detail', description: 'per-candidate point-in-time evidence (candidate-specific part only; the shared context lives in decision-context): full detail for SELECTED, FINALIST, NEAR_BOUNDARY and ANOMALY, identity + reason + hash for ordinary rejected',
    tables: ['dp.pit_candidate'], datasetClass: 'RUNTIME_EVIDENCE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P1_SELECTED_AND_FINALIST_EVIDENCE', partition: { column: 'session_date', ...SESSION }, hotSessions: 10, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'candidate id, tier, hashes and rejection reason code stay in the compact decision audit',
    whyHot: 'outcome labels resolve over horizons up to the end of day and next sessions; management compares against the entry thesis', whyWarm: 'research on boundary behaviour',
    archiveWhen: 'session close plus verification', removeFromPostgresWhen: 'ten sessions after close when verified', restoredHow: 'Parquet partition by session_date and candidate id',
    value: { operational: 1, audit: 2, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'candidate-ordinary-rejected', description: 'ordinary rejected contracts of a decision (thousands per cycle on a full chain): hot form is aggregate counts and hashes only',
    tables: ['dp.rejection_histogram'], datasetClass: 'RESEARCH_HISTORY', growthLifecycleClass: 'AGGREGATE_THEN_ARCHIVE_RAW', writePriority: 'P2_FULL_RESEARCH', partition: { column: 'session_date', granularity: 'WEEK' }, hotSessions: 20, warmSessions: 60, coldPolicy: 'COMPACT_THEN_ARCHIVE_DETAIL',
    compactHotForm: 'per-decision rejection histogram (reason code to exact count) and the hash of the complete candidate list; the complete rows live in the cycle evidence blob and the Parquet candidate archive',
    whyHot: 'dashboards and funnel reports need counts, not rows', whyWarm: 'research reads the full rows from Parquet, never from PostgreSQL', archiveWhen: 'the full rows are archived from the first session close; only the histogram is hot',
    removeFromPostgresWhen: 'never stored hot as rows', restoredHow: 'Parquet candidate archive, verified against the hash in the histogram row', value: { operational: 0, audit: 1, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'decision-audit', description: 'bounded recent decision identity: time, action, strategy, selected candidate, quantity, AEGIS, sizing, binding constraint, versions, chain terminality, archive id and hash',
    tables: ['dp.recent_decision_audit'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'BOUNDED_RECENT_WINDOW', writePriority: 'P0_OPERATIONAL', partition: { column: 'session_date', granularity: 'SESSION_DATE' }, hotSessions: 60, warmSessions: 250, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'bounded recent identity plus archive locator; older truth resolves through the chained session manifest and cold archive', whyHot: 'recent audit and incident lookup', whyWarm: 'frequent replay without remote retrieval', archiveWhen: 'full decision truth archives at session finalization', removeFromPostgresWhen: '60 sessions after final-chain, two-authority, hash and replay verification',
    restoredHow: 'EvidenceReader resolves the session manifest and archive locator by decision id', value: { operational: 2, audit: 3, research: 2, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'frontier-summary', description: 'frontier summary: counts, finalists, boundary candidates, selected candidate, binding constraints, risk result',
    tables: ['trade.canonical_strategy_frontier'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P1_SELECTED_AND_FINALIST_EVIDENCE', partition: { column: 'observed_at', granularity: 'WEEK' }, hotSessions: 60, warmSessions: 120, coldPolicy: 'COMPACT_THEN_ARCHIVE_DETAIL',
    compactHotForm: 'bounded projection (already bounded to a constant size by the Phase 3 projection contract)', whyHot: 'frontier explanations for recent decisions', whyWarm: 'research', archiveWhen: 'detail is in the cycle blob from the start', removeFromPostgresWhen: 'summary retires after 60 sessions once archived',
    restoredHow: 'cycle blob by archive hash', value: { operational: 1, audit: 3, research: 2, reconstructionCost: 'MEDIUM', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'shadow-opportunity', description: 'shadow opportunities (virtual trades) and their resolutions', tables: ['trade.shadow_opportunity'], datasetClass: 'RESEARCH_HISTORY', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P2_FULL_RESEARCH', partition: { column: 'decision_time', granularity: 'WEEK' }, hotSessions: 20, warmSessions: 60,
    coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION', compactHotForm: 'daily aggregates', whyHot: 'resolution needs open shadow positions until their horizon closes', whyWarm: 'training datasets read the archive', archiveWhen: 'after resolution',
    removeFromPostgresWhen: 'twenty sessions after close', restoredHow: 'Parquet by month', value: { operational: 0, audit: 1, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'optionomics-raw-observation', description: 'raw Optionomics responses, content-addressed (same response_hash stored once) with observation records separate from payload blobs', tables: ['dp.payload_blob', 'market.optionomics_raw_observation'],
    datasetClass: 'RAW_PROVIDER_PAYLOAD', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P3_RAW_PROVIDER_PAYLOAD', partition: { column: 'session_date', ...SESSION }, hotSessions: 3, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'observation row keeps request identity, provider, time, status, latency, payload hash and archive reference', whyHot: 'a payload is only re-read while its derived features are being checked',
    whyWarm: 'research on provider behaviour', archiveWhen: 'after session close', removeFromPostgresWhen: 'three sessions after close when verified', restoredHow: 'content hash lookup',
    value: { operational: 0, audit: 2, research: 2, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'RARE' },
  },
  {
    id: 'optionomics-payload-blob', description: 'content-addressed raw provider payload bytes (the same bytes observed twice are stored once); observations in optionomics-raw-observation reference them by hash',
    tables: ['dp.payload_blob'], datasetClass: 'RAW_PROVIDER_PAYLOAD', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P3_RAW_PROVIDER_PAYLOAD', partition: { column: 'session_date', ...SESSION }, hotSessions: 3, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'the observation row keeps the payload hash, size and archive reference', whyHot: 'a payload is only re-read while its derived features are being checked', whyWarm: 'research on provider behaviour',
    archiveWhen: 'after session close', removeFromPostgresWhen: 'three sessions after close when verified', restoredHow: 'content hash lookup through the archive manifest',
    value: { operational: 0, audit: 2, research: 2, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'RARE' },
  },
  {
    id: 'optionomics-feature', description: 'derived Optionomics feature state per decision', tables: ['market.optionomics_feature_snapshot'], datasetClass: 'RUNTIME_EVIDENCE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P2_FULL_RESEARCH', partition: { column: 'observed_at', granularity: 'WEEK' }, hotSessions: 5, warmSessions: 20,
    coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION', compactHotForm: 'feature version and content hash', whyHot: 'recent features explain recent decisions', whyWarm: 'research', archiveWhen: 'after session close', removeFromPostgresWhen: 'five sessions',
    restoredHow: 'Parquet by month', value: { operational: 0, audit: 1, research: 3, reconstructionCost: 'HIGH', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'execution-observation', description: 'Command-5A / execution observation jobs and marks', tables: ['research.theta_execution_observation_job', 'market.execution_quote_observation'], datasetClass: 'RUNTIME_EVIDENCE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P2_FULL_RESEARCH',
    partition: { column: 'created_at', ...SESSION }, hotSessions: 5, warmSessions: 20, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION', compactHotForm: 'unresolved jobs only (scheduling and label resolution need them); resolved marks go to Parquet',
    whyHot: 'pending jobs and recent marks drive scheduling and troubleshooting', whyWarm: 'label audits', archiveWhen: 'a mark is resolved and its session is closed', removeFromPostgresWhen: 'five sessions after resolution', restoredHow: 'Parquet by month',
    value: { operational: 1, audit: 1, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'outcome-observation', description: 'resolved outcome labels and receipts', tables: ['research.theta_outcome_subject', 'research.theta_outcome_resolution_receipt'], datasetClass: 'RESEARCH_HISTORY', growthLifecycleClass: 'AGGREGATE_THEN_ARCHIVE_RAW', writePriority: 'P1_SELECTED_AND_FINALIST_EVIDENCE', partition: { column: 'created_at', granularity: 'MONTH' },
    hotSessions: 60, warmSessions: 250, coldPolicy: 'COMPACT_THEN_ARCHIVE_DETAIL', compactHotForm: 'label value, horizon and receipt hash', whyHot: 'small and queried often', whyWarm: 'training', archiveWhen: 'with the decision it labels',
    removeFromPostgresWhen: 'detail after 60 sessions', restoredHow: 'Parquet', value: { operational: 0, audit: 2, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'WEEKLY' },
  },
  {
    id: 'provider-request-history', description: 'provider request metadata', tables: ['ops.provider_request'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'AGGREGATE_THEN_ARCHIVE_RAW', writePriority: 'P3_RAW_PROVIDER_PAYLOAD', partition: { column: 'requested_at', granularity: 'MONTH' }, hotSessions: 30, warmSessions: 120,
    coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION', compactHotForm: 'daily aggregates by provider, status and latency band', whyHot: 'rate-limit and incident forensics', whyWarm: 'provider reliability research', archiveWhen: 'month closes',
    removeFromPostgresWhen: '30 sessions', restoredHow: 'Parquet by month', value: { operational: 1, audit: 2, research: 1, reconstructionCost: 'MEDIUM', accessFrequency: 'RARE' },
  },
  {
    id: 'runtime-diagnostics', description: 'worker cycles, scheduler checkpoints and routine (GOOD) reconciliation snapshots: about 5 MiB per day on any day the worker runs, including idle days',
    tables: ['ops.runtime_worker_cycle', 'ops.scheduler_checkpoint', 'trade.broker_reconciliation_snapshot'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'AGGREGATE_THEN_ARCHIVE_RAW', writePriority: 'P2_FULL_RESEARCH', partition: { column: 'created_at', granularity: 'WEEK' }, hotSessions: 30, warmSessions: 120,
    coldPolicy: 'COMPACT_THEN_ARCHIVE_DETAIL', compactHotForm: 'daily aggregates (cycle counts, failure counts, latency bands) plus EVERY non-GOOD reconciliation snapshot and the latest GOOD one stay hot permanently',
    whyHot: 'incident forensics over the recent past', whyWarm: 'reliability research', archiveWhen: 'a week closes', removeFromPostgresWhen: 'about 30 sessions after close', restoredHow: 'Parquet by week',
    value: { operational: 1, audit: 2, research: 1, reconstructionCost: 'MEDIUM', accessFrequency: 'RARE' },
  },
  {
    id: 'broker-history', description: 'orders, fills, execution attempts, reconciliation, positions, inventory, action plans, lifecycle, whole-chain accounting',
    tables: ['trade.order_intent', 'trade.broker_order', 'trade.fill', 'trade.execution_attempt', 'trade.master_paper_action_plan', 'trade.broker_reconciliation_snapshot', 'trade.stock_lot'],
    datasetClass: 'OPERATIONAL_TRUTH', growthLifecycleClass: 'ACTIVE_OPERATIONAL_TRUTH', writePriority: 'P0_OPERATIONAL', partition: { column: null, granularity: 'NONE' }, hotSessions: 'PERMANENT', warmSessions: 0, coldPolicy: 'NEVER_LEAVES_POSTGRES', compactHotForm: 'only active or unresolved chains, orders, fills, inventory and latest reconciliation truth',
    whyHot: 'active execution, inventory and accounting truth must remain immediately available', whyWarm: 'n/a', archiveWhen: 'terminal chains are copied to finalized-execution-history only after FINAL_CHAIN_RECEIPT', removeFromPostgresWhen: 'active or unresolved rows never leave',
    restoredHow: 'n/a', value: { operational: 3, audit: 3, research: 2, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'EVERY_CYCLE' },
  },
  {
    id: 'finalized-execution-history', description: 'terminal, fully reconciled broker and whole-chain history selected by a verified FINAL_CHAIN_RECEIPT',
    tables: ['dp.finalized_execution_history'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'ARCHIVE_THEN_COMPACT', writePriority: 'P0_OPERATIONAL', partition: { column: 'session_date', granularity: 'MONTH' }, hotSessions: 60, warmSessions: 250, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'bounded recent compressed whole-chain records; final receipts and session roots retain identity', whyHot: 'recent disputes and accounting checks', whyWarm: 'whole-chain research and audit replay',
    archiveWhen: 'only after orders, fills, inventory, assignment, management, economics and required future labels are terminal or explicitly provider-limited', removeFromPostgresWhen: '60 sessions after two-authority archive, hash and replay verification', restoredHow: 'EvidenceReader by chain id and final-chain receipt hash',
    value: { operational: 2, audit: 3, research: 3, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'final-chain-receipt', description: 'terminal-chain eligibility and resolution proof, never a substitute for the archived execution history',
    tables: ['dp.final_chain_receipt'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'BOUNDED_RECENT_WINDOW', writePriority: 'P0_OPERATIONAL', partition: { column: 'session_date', granularity: 'MONTH' }, hotSessions: 60, warmSessions: 250, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'receipt hash is linked from the session manifest and finalized execution archive', whyHot: 'archive eligibility and recent accounting disputes', whyWarm: 'integrity and whole-chain replay checks', archiveWhen: 'with finalized execution history', removeFromPostgresWhen: '60 sessions after two-authority archive and replay verification', restoredHow: 'EvidenceReader by chain id and receipt hash',
    value: { operational: 2, audit: 3, research: 2, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'session-integrity-manifest', description: 'compact finalized session manifest containing the decision Merkle root and chained session root',
    tables: ['dp.session_integrity_manifest'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'TRULY_TINY_PERMANENT_METADATA', writePriority: 'P0_OPERATIONAL', partition: { column: 'session_date', granularity: 'MONTH' }, hotSessions: 2520, warmSessions: 2520, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'bounded ten-year manifest window plus dp.session_integrity_head singleton', whyHot: 'fast integrity proof and archive lookup', whyWarm: 'audit verification', archiveWhen: 'at session finalization', removeFromPostgresWhen: 'after 2,520 sessions; latest chained root remains in the singleton head', restoredHow: 'manifest archive by session id and chained root',
    value: { operational: 1, audit: 3, research: 1, reconstructionCost: 'IRREPLACEABLE', accessFrequency: 'DAILY' },
  },
  {
    id: 'runtime-session-aggregate', description: 'one bounded aggregate per session for worker, decision, provider, error, latency and storage diagnostics',
    tables: ['dp.runtime_session_aggregate'], datasetClass: 'AUDIT_LINEAGE', growthLifecycleClass: 'BOUNDED_RECENT_WINDOW', writePriority: 'P0_OPERATIONAL', partition: { column: 'session_date', granularity: 'MONTH' }, hotSessions: 2520, warmSessions: 2520, coldPolicy: 'ARCHIVE_THEN_RETIRE_PARTITION',
    compactHotForm: 'latest aggregate remains visible through the storage receipt and session manifest', whyHot: 'operations and trend diagnostics', whyWarm: 'reliability research', archiveWhen: 'after session finalization', removeFromPostgresWhen: 'after 2,520 sessions and two-authority verification', restoredHow: 'EvidenceReader by session date and content hash',
    value: { operational: 1, audit: 2, research: 1, reconstructionCost: 'LOW', accessFrequency: 'DAILY' },
  },
];

/** Operational truth can never be configured to leave PostgreSQL. */
export function validateRegistry(registry: readonly DatasetPolicy[] = datasetRegistry): readonly string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const policy of registry) {
    if (ids.has(policy.id)) problems.push(`DUPLICATE_ID:${policy.id}`);
    ids.add(policy.id);
    if (policy.datasetClass === 'OPERATIONAL_TRUTH' && (policy.coldPolicy !== 'NEVER_LEAVES_POSTGRES' || policy.hotSessions !== 'PERMANENT')) problems.push(`OPERATIONAL_MUST_STAY_HOT:${policy.id}`);
    if (policy.coldPolicy === 'NEVER_LEAVES_POSTGRES' && policy.hotSessions !== 'PERMANENT') problems.push(`NEVER_LEAVES_REQUIRES_PERMANENT:${policy.id}`);
    if (policy.hotSessions !== 'PERMANENT' && (!Number.isInteger(policy.hotSessions) || policy.hotSessions < 1)) problems.push(`HOT_WINDOW_INVALID:${policy.id}`);
    if (!Number.isInteger(policy.warmSessions) || policy.warmSessions < 0) problems.push(`WARM_WINDOW_INVALID:${policy.id}`);
    for (const field of ['whyHot', 'whyWarm', 'archiveWhen', 'removeFromPostgresWhen', 'restoredHow', 'compactHotForm'] as const) if (policy[field].trim().length < 3) problems.push(`MISSING_${field}:${policy.id}`);
    if (policy.coldPolicy !== 'NEVER_LEAVES_POSTGRES' && policy.partition.granularity === 'NONE') problems.push(`RETIREMENT_NEEDS_PARTITIONING:${policy.id}`);
    if (policy.value.reconstructionCost === 'IRREPLACEABLE' && policy.coldPolicy !== 'NEVER_LEAVES_POSTGRES' && policy.warmSessions < 1) problems.push(`IRREPLACEABLE_NEEDS_WARM_COPY:${policy.id}`);
  }
  return problems;
}

/** VALUE_BYTES_RATIO = (3*operational + 2*audit + research) / (hot MiB per decision). Higher is better; a low ratio marks data that should not be hot. */
export function valueBytesRatio(value: DatasetValue, hotBytesPerDecision: number): number | null {
  if (!(hotBytesPerDecision > 0)) return null;
  return (3 * value.operational + 2 * value.audit + value.research) / (hotBytesPerDecision / 1048576);
}

export const hotSessionsFor = (policy: DatasetPolicy): number => (policy.hotSessions === 'PERMANENT' ? Number.POSITIVE_INFINITY : policy.hotSessions);

const toIsoDate = (value: string): Date => new Date(`${value.slice(0, 10)}T12:00:00Z`);
/** ISO week key, for example 2026-W41 */
function weekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** the partition a session date belongs to under a granularity */
export function partitionKeyFor(sessionDate: string, granularity: PartitionGranularity): string {
  if (granularity === 'SESSION_DATE') return sessionDate.slice(0, 10);
  if (granularity === 'MONTH') return sessionDate.slice(0, 7);
  if (granularity === 'WEEK') return weekKey(toIsoDate(sessionDate));
  throw new Error('PARTITION_KEY_UNPARTITIONED');
}

/** how many CLOSED partitions stay hot for a dataset: hot sessions converted to the partition granularity (rounded up) */
export function hotPartitionsFor(policy: DatasetPolicy): number {
  if (policy.hotSessions === 'PERMANENT') return Number.POSITIVE_INFINITY;
  return policy.partition.granularity === 'WEEK' ? Math.ceil(policy.hotSessions / 5) : policy.partition.granularity === 'MONTH' ? Math.ceil(policy.hotSessions / 21) : policy.hotSessions;
}
