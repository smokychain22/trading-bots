import type { Pool } from 'pg';
import {
  canonicalStrategyFrontierContentHash,
  type CanonicalStrategyFrontier,
} from '../theta/canonical-strategy-frontier.js';
import { projectCanonicalStrategyEvidence } from '../theta/postgres-theta-cycle-store.js';
import { decodeCycleEvidenceArchive } from '../theta/postgres-cycle-evidence-storage.js';
import { LocalResearchHistorySpool, type LocalResearchBatchReceipt } from './local-research-history-spool.js';

export const canonicalFrontierLocalArchiveVersion = 'theta-canonical-frontier-local-archive-v2' as const;

interface FrontierRow {
  readonly frontier_id: string;
  readonly fusion_snapshot_id: string;
  readonly observed_at: string | Date;
  readonly content_hash: string;
  readonly frontier_json: unknown;
  readonly evidence_archive_gzip: Buffer | null;
}

interface FrontierIdentityRow extends Pick<FrontierRow,
  'frontier_id' | 'fusion_snapshot_id' | 'observed_at' | 'content_hash'> {
  readonly created_at: string | Date;
}

export interface CanonicalFrontierArchiveReport {
  readonly contractVersion: typeof canonicalFrontierLocalArchiveVersion;
  readonly state: 'ARCHIVED_LOCAL_SQLITE' | 'NO_FRONTIERS_IN_WINDOW' | 'PARTIAL_LIMIT_REACHED';
  readonly coverageComplete: boolean;
  readonly frontierCount: number;
  readonly researchRowCount: number;
  readonly reproducibleHashCount: number;
  readonly legacyEmbeddedHashCount: number;
  readonly pendingParquetBatchCount: number;
  readonly sourceFrontierCount: number;
  readonly backlogStart: number;
  readonly batchesProcessed: number;
  readonly backlogEnd: number;
  readonly backlogMonotonic: boolean;
  readonly oldestPendingCreatedAt: string | null;
  readonly newestPendingCreatedAt: string | null;
  readonly oldestPendingAgeSeconds: number | null;
  readonly newestPendingAgeSeconds: number | null;
  readonly brokerAuthority: false;
}

function object(value: unknown, reason: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(reason);
  return value as Record<string, unknown>;
}

export function canonicalFrontierResearchBatch(
  raw: unknown,
  rowIdentity: Pick<FrontierRow, 'frontier_id' | 'fusion_snapshot_id' | 'observed_at' | 'content_hash'>,
  sourceSha: string,
): { readonly receiptInput: Parameters<LocalResearchHistorySpool['append']>[0]; readonly rowCount: number;
  readonly hashVerification: 'REPRODUCIBLE_PERSISTED_JSON' | 'LEGACY_EMBEDDED_HASH_MATCH' } {
  const frontierObject = object(raw, 'LOCAL_ARCHIVE_FRONTIER_NOT_OBJECT');
  if (frontierObject.contentHash !== rowIdentity.content_hash) throw new Error('LOCAL_ARCHIVE_FRONTIER_ROW_HASH_MISMATCH');
  const { contentHash: ignored, ...withoutHash } = frontierObject;
  void ignored;
  const reproducible = canonicalStrategyFrontierContentHash(
    withoutHash as Omit<CanonicalStrategyFrontier, 'contentHash'>,
  ) === rowIdentity.content_hash;
  // Historical v1 rows predate persistence-stable hash semantics. Their
  // embedded hash and relational hash still have to agree, but omitted
  // undefined properties cannot be reconstructed from JSONB. New rows carry
  // the D locked-plan field and must always pass full recomputation.
  const legacy = !Object.hasOwn(frontierObject, 'definedRiskLockedPlan');
  if (!reproducible && !legacy) throw new Error('LOCAL_ARCHIVE_FRONTIER_CONTENT_HASH_INVALID');
  const hashVerification = reproducible ? 'REPRODUCIBLE_PERSISTED_JSON' : 'LEGACY_EMBEDDED_HASH_MATCH';
  const frontier = frontierObject as unknown as CanonicalStrategyFrontier;
  const rows: unknown[] = [];
  for (const projection of projectCanonicalStrategyEvidence(frontier)) {
    if (projection.candidates.length === 0) rows.push({
      recordType: 'BRANCH_WITHOUT_CANDIDATES' as const,
      branch: projection.branch,
      selected: false,
      candidate: null,
      frontierId: rowIdentity.frontier_id,
      fusionSnapshotId: rowIdentity.fusion_snapshot_id,
      frontierContentHash: rowIdentity.content_hash,
      sourceHashVerification: hashVerification,
    });
    else for (const { candidate, selected } of projection.candidates) rows.push({
        recordType: 'BRANCH_CANDIDATE' as const,
        branch: projection.branch,
        selected,
        candidate,
        frontierId: rowIdentity.frontier_id,
        fusionSnapshotId: rowIdentity.fusion_snapshot_id,
        frontierContentHash: rowIdentity.content_hash,
        sourceHashVerification: hashVerification,
      });
  }
  return {
    rowCount: rows.length,
    receiptInput: {
      batchId: rowIdentity.frontier_id,
      family: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE',
      sourceSha,
      decisionCycleId: rowIdentity.fusion_snapshot_id,
      snapshotId: frontier.snapshotId,
      observedAt: new Date(rowIdentity.observed_at).toISOString(),
      rowCount: rows.length,
      payload: rows,
    }, hashVerification,
  };
}

export async function archiveCanonicalStrategyFrontiers(input: {
  readonly pool: Pool;
  readonly spoolPath: string;
  readonly sourceSha: string;
  readonly since: string;
  readonly limit?: number;
}): Promise<CanonicalFrontierArchiveReport> {
  const since = new Date(input.since);
  if (!Number.isFinite(since.getTime())) throw new Error('LOCAL_ARCHIVE_SINCE_INVALID');
  const limit = input.limit ?? 10_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('LOCAL_ARCHIVE_LIMIT_INVALID');
  const spool = new LocalResearchHistorySpool(input.spoolPath);
  let researchRowCount = 0;
  let reproducibleHashCount = 0;
  let legacyEmbeddedHashCount = 0;
  const receipts: LocalResearchBatchReceipt[] = [];
  try {
    const identities = await input.pool.query<FrontierIdentityRow>(
      `SELECT f.frontier_id::text,f.fusion_snapshot_id::text,f.observed_at,f.content_hash,f.created_at
         FROM trade.canonical_strategy_frontier f
        WHERE f.created_at >= $1::timestamptz
        ORDER BY f.created_at,f.frontier_id`,
      [since.toISOString()],
    );
    const existingBatchIds = spool.batchIds();
    const missing = identities.rows.filter((row) => !existingBatchIds.has(row.frontier_id));
    const backlogStart = missing.length;
    const identitiesToArchive = missing.slice(0, limit);
    const idsToArchive = identitiesToArchive.map((row) => row.frontier_id);
    const result = idsToArchive.length === 0 ? { rows: [] as FrontierRow[] }
      : await input.pool.query<FrontierRow>(
        `SELECT f.frontier_id::text,f.fusion_snapshot_id::text,f.observed_at,f.content_hash,f.frontier_json,
                s.evidence_archive_gzip
           FROM trade.canonical_strategy_frontier f
           JOIN trade.fusion_snapshot s USING(fusion_snapshot_id)
          WHERE f.frontier_id = ANY($1::uuid[])
          ORDER BY f.created_at,f.frontier_id`,
        [idsToArchive],
      );
    if (result.rows.length !== idsToArchive.length) throw new Error('LOCAL_ARCHIVE_SOURCE_ROWS_INCOMPLETE');
    for (const row of result.rows) {
      const archivedFrontier = row.evidence_archive_gzip===null ? row.frontier_json
        : decodeCycleEvidenceArchive(row.evidence_archive_gzip).strategyFrontier;
      const batch = canonicalFrontierResearchBatch(archivedFrontier, row, input.sourceSha);
      receipts.push(spool.append(batch.receiptInput));
      researchRowCount += batch.rowCount;
      if (batch.hashVerification === 'REPRODUCIBLE_PERSISTED_JSON') reproducibleHashCount += 1;
      else legacyEmbeddedHashCount += 1;
    }
    const verification = spool.verify();
    if (!verification.valid) throw new Error('LOCAL_ARCHIVE_SQLITE_VERIFICATION_FAILED');
    const coverageComplete = backlogStart <= receipts.length;
    const backlogEnd = Math.max(0, backlogStart - receipts.length);
    const remaining = missing.slice(receipts.length);
    const newestRemaining = remaining.at(-1);
    const created = (row: FrontierIdentityRow): string => new Date(row.created_at).toISOString();
    const age = (row: FrontierIdentityRow | undefined): number | null => row === undefined ? null
      : Math.max(0, (Date.now() - new Date(row.created_at).getTime()) / 1_000);
    const stats = spool.stats();
    return {
      contractVersion: canonicalFrontierLocalArchiveVersion,
      state: !coverageComplete ? 'PARTIAL_LIMIT_REACHED'
        : receipts.length === 0 ? 'NO_FRONTIERS_IN_WINDOW' : 'ARCHIVED_LOCAL_SQLITE',
      coverageComplete,
      frontierCount: receipts.length,
      researchRowCount,
      reproducibleHashCount,
      legacyEmbeddedHashCount,
      pendingParquetBatchCount: stats.pendingParquetBatchCount,
      sourceFrontierCount: identities.rows.length,
      backlogStart,
      batchesProcessed: receipts.length,
      backlogEnd,
      backlogMonotonic: backlogEnd <= backlogStart,
      oldestPendingCreatedAt: remaining[0] === undefined ? null : created(remaining[0]),
      newestPendingCreatedAt: newestRemaining === undefined ? null : created(newestRemaining),
      oldestPendingAgeSeconds: age(remaining[0]),
      newestPendingAgeSeconds: age(newestRemaining),
      brokerAuthority: false,
    };
  } finally {
    spool.close();
  }
}
