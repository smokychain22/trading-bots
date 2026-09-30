import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export const localResearchHistorySpoolVersion = 'multi-bot-local-research-history-spool-v3' as const;

export type LocalResearchFamily =
  | 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE'
  | 'CONTRACT_PATH_OBSERVATION'
  | 'CONTRACT_PATH_DATASET';

export interface LocalResearchBatchInput {
  readonly botNamespace: string;
  readonly batchId: string;
  readonly family: LocalResearchFamily;
  readonly sourceSha: string;
  readonly decisionCycleId: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly rowCount: number;
  readonly payload: unknown;
}

export interface LocalResearchBatchReceipt {
  readonly botNamespace: string;
  readonly batchId: string;
  readonly family: LocalResearchFamily;
  readonly sourceSha: string;
  readonly decisionCycleId: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly rowCount: number;
  readonly payloadHash: string;
  readonly storageState: 'PENDING_PARQUET' | 'ARCHIVED_PARQUET';
  readonly brokerAuthority: false;
}

export interface LocalResearchSpoolStats {
  readonly totalBatchCount: number;
  readonly pendingParquetBatchCount: number;
  readonly archivedParquetBatchCount: number;
  readonly oldestPendingObservedAt: string | null;
  readonly newestPendingObservedAt: string | null;
}

export interface VerifiedLocalResearchBatch<T = unknown> {
  readonly receipt: LocalResearchBatchReceipt;
  readonly payload: readonly T[];
}

type BatchRow = {
  bot_namespace: string; batch_id: string; family: LocalResearchFamily; source_sha: string; decision_cycle_id: string;
  snapshot_id: string; observed_at: string; row_count: number; payload_json: string; payload_hash: string;
  storage_state: 'PENDING_PARQUET' | 'ARCHIVED_PARQUET'; archived_manifest_hash: string | null;
};
type BatchMetadataRow = Omit<BatchRow, 'payload_json' | 'archived_manifest_hash'>;
const batchMetadataColumns = `bot_namespace,batch_id,family,source_sha,decision_cycle_id,snapshot_id,
  observed_at,row_count,payload_hash,storage_state`;

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/;
const SHA = /^[0-9a-f]{40}$/;
const SECRET_KEY = /^(authorization|cookie|set-cookie|password|api[-_]?key|api[-_]?secret|secret|token|access[-_]?token|refresh[-_]?token|credential|connection[-_]?string|database[-_]?url)$/i;
const SECRET_VALUE = [
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /APCA-API-(?:KEY-ID|SECRET-KEY)/i,
];
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function assertSafeResearchPayload(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeResearchPayload(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error(`LOCAL_RESEARCH_SECRET_KEY_REJECTED:${path}.${key}`);
      assertSafeResearchPayload(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.some((pattern) => pattern.test(value))) {
    throw new Error(`LOCAL_RESEARCH_SECRET_VALUE_REJECTED:${path}`);
  }
}

function rowReceipt(row: BatchMetadataRow): LocalResearchBatchReceipt {
  return {
    botNamespace: row.bot_namespace, batchId: row.batch_id, family: row.family, sourceSha: row.source_sha,
    decisionCycleId: row.decision_cycle_id, snapshotId: row.snapshot_id,
    observedAt: new Date(row.observed_at).toISOString(), rowCount: row.row_count,
    payloadHash: row.payload_hash, storageState: row.storage_state, brokerAuthority: false,
  };
}

/**
 * Local research-only WAL. It cannot authorize execution and is never used as
 * a substitute for canonical PostgreSQL state. Immutable batches are compacted
 * into verified Parquet during closed-market maintenance.
 */
export class LocalResearchHistorySpool {
  private readonly database: DatabaseSync;

  constructor(path = '.theta-local-worker/research-spool/theta-research.sqlite') {
    const databasePath = resolve(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS research_batch(
      bot_namespace TEXT NOT NULL,
      batch_id TEXT PRIMARY KEY,
      family TEXT NOT NULL CHECK(family IN ('CANONICAL_STRATEGY_CANDIDATE_EVIDENCE','CONTRACT_PATH_OBSERVATION','CONTRACT_PATH_DATASET')),
      source_sha TEXT NOT NULL,
      decision_cycle_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK(row_count >= 0),
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      storage_state TEXT NOT NULL CHECK(storage_state IN ('PENDING_PARQUET','ARCHIVED_PARQUET')),
      archived_manifest_hash TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(family,decision_cycle_id,snapshot_id,payload_hash));
      CREATE INDEX IF NOT EXISTS ix_research_batch_pending
        ON research_batch(storage_state,observed_at,batch_id);
      CREATE INDEX IF NOT EXISTS ix_research_batch_cycle_family
        ON research_batch(decision_cycle_id,family,observed_at,batch_id);`);
    const schema = this.database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='research_batch'")
      .get() as { sql: string } | undefined;
    if (schema !== undefined && !schema.sql.includes('CONTRACT_PATH_DATASET')) this.upgradeFamilyConstraint();
    const columns = this.database.prepare("PRAGMA table_info('research_batch')").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'bot_namespace')) {
      this.database.exec("ALTER TABLE research_batch ADD COLUMN bot_namespace TEXT NOT NULL DEFAULT 'THETA'");
    }
  }

  private upgradeFamilyConstraint(): void {
    this.database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE research_batch_v2(
        bot_namespace TEXT NOT NULL DEFAULT 'THETA',
        batch_id TEXT PRIMARY KEY,
        family TEXT NOT NULL CHECK(family IN ('CANONICAL_STRATEGY_CANDIDATE_EVIDENCE','CONTRACT_PATH_OBSERVATION','CONTRACT_PATH_DATASET')),
        source_sha TEXT NOT NULL,
        decision_cycle_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        row_count INTEGER NOT NULL CHECK(row_count >= 0),
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        storage_state TEXT NOT NULL CHECK(storage_state IN ('PENDING_PARQUET','ARCHIVED_PARQUET')),
        archived_manifest_hash TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(family,decision_cycle_id,snapshot_id,payload_hash));
      INSERT INTO research_batch_v2(batch_id,family,source_sha,decision_cycle_id,snapshot_id,observed_at,row_count,
        payload_json,payload_hash,storage_state,archived_manifest_hash,created_at)
        SELECT batch_id,family,source_sha,decision_cycle_id,snapshot_id,observed_at,row_count,
          payload_json,payload_hash,storage_state,archived_manifest_hash,created_at FROM research_batch;
      DROP TABLE research_batch;
      ALTER TABLE research_batch_v2 RENAME TO research_batch;
      CREATE INDEX ix_research_batch_pending ON research_batch(storage_state,observed_at,batch_id);
      CREATE INDEX ix_research_batch_cycle_family ON research_batch(decision_cycle_id,family,observed_at,batch_id);
      COMMIT;`);
  }

  close(): void { this.database.close(); }

  append(input: LocalResearchBatchInput): LocalResearchBatchReceipt {
    for (const [name, value] of [['botNamespace', input.botNamespace], ['batchId', input.batchId], ['decisionCycleId', input.decisionCycleId],
      ['snapshotId', input.snapshotId]] as const) {
      if (!SAFE_ID.test(value)) throw new Error(`LOCAL_RESEARCH_${name.toUpperCase()}_INVALID`);
    }
    if (!SHA.test(input.sourceSha)) throw new Error('LOCAL_RESEARCH_SOURCE_SHA_INVALID');
    const observedAt = new Date(input.observedAt);
    if (!Number.isFinite(observedAt.getTime())) throw new Error('LOCAL_RESEARCH_OBSERVED_AT_INVALID');
    if (!Number.isInteger(input.rowCount) || input.rowCount < 0) throw new Error('LOCAL_RESEARCH_ROW_COUNT_INVALID');
    if (!Array.isArray(input.payload) || input.payload.length !== input.rowCount) {
      throw new Error('LOCAL_RESEARCH_PAYLOAD_ROW_COUNT_MISMATCH');
    }
    assertSafeResearchPayload(input.payload);
    const payloadJson = canonicalJson(input.payload);
    const payloadHash = sha256(payloadJson);
    const existing = this.database.prepare('SELECT * FROM research_batch WHERE batch_id=?')
      .get(input.batchId) as BatchRow | undefined;
    if (existing !== undefined) {
      if (existing.bot_namespace !== input.botNamespace || existing.family !== input.family || existing.source_sha !== input.sourceSha
        || existing.decision_cycle_id !== input.decisionCycleId || existing.snapshot_id !== input.snapshotId
        || existing.observed_at !== observedAt.toISOString() || existing.row_count !== input.rowCount
        || existing.payload_hash !== payloadHash) throw new Error('LOCAL_RESEARCH_BATCH_IDENTITY_CONFLICT');
      return rowReceipt(existing);
    }
    this.database.prepare(`INSERT INTO research_batch(bot_namespace,batch_id,family,source_sha,decision_cycle_id,snapshot_id,
      observed_at,row_count,payload_json,payload_hash,storage_state,archived_manifest_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING_PARQUET',NULL,?)`).run(input.botNamespace,input.batchId,input.family,input.sourceSha,
      input.decisionCycleId,input.snapshotId,observedAt.toISOString(),input.rowCount,payloadJson,payloadHash,
      new Date().toISOString());
    return {
      botNamespace: input.botNamespace, batchId: input.batchId, family: input.family, sourceSha: input.sourceSha,
      decisionCycleId: input.decisionCycleId, snapshotId: input.snapshotId,
      observedAt: observedAt.toISOString(), rowCount: input.rowCount, payloadHash,
      storageState: 'PENDING_PARQUET', brokerAuthority: false,
    };
  }

  pending(limit = 100): readonly LocalResearchBatchReceipt[] {
    const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
    return (this.database.prepare(`SELECT ${batchMetadataColumns} FROM research_batch WHERE storage_state='PENDING_PARQUET'
      ORDER BY observed_at,batch_id LIMIT ?`).all(bounded) as unknown as BatchMetadataRow[]).map(rowReceipt);
  }

  batchIds(): ReadonlySet<string> {
    const rows = this.database.prepare('SELECT batch_id FROM research_batch').all() as unknown as Array<{
      batch_id: string;
    }>;
    return new Set(rows.map((row) => row.batch_id));
  }

  hasBatch(batchId: string): boolean {
    if (!SAFE_ID.test(batchId)) throw new Error('LOCAL_RESEARCH_BATCH_ID_INVALID');
    return this.database.prepare('SELECT 1 AS present FROM research_batch WHERE batch_id=?')
      .get(batchId) !== undefined;
  }

  verifyBatch(batchId: string): boolean {
    if (!SAFE_ID.test(batchId)) throw new Error('LOCAL_RESEARCH_BATCH_ID_INVALID');
    const row = this.database.prepare('SELECT * FROM research_batch WHERE batch_id=?')
      .get(batchId) as BatchRow | undefined;
    if (row === undefined) return false;
    let payload: unknown;
    try { payload = JSON.parse(row.payload_json); } catch { return false; }
    return Array.isArray(payload) && payload.length === row.row_count
      && sha256(canonicalJson(payload)) === row.payload_hash;
  }

  /** Reads one bounded decision-cycle slice and verifies every payload before
   * returning it. This avoids full-history reloads in the maturation worker. */
  readDecisionCycleBatches<T = unknown>(input: {
    readonly decisionCycleId: string;
    readonly family: LocalResearchFamily;
    readonly snapshotId?: string;
    readonly limit?: number;
  }): readonly VerifiedLocalResearchBatch<T>[] {
    if (!SAFE_ID.test(input.decisionCycleId)) throw new Error('LOCAL_RESEARCH_DECISION_CYCLE_ID_INVALID');
    if (input.snapshotId !== undefined && !SAFE_ID.test(input.snapshotId)) {
      throw new Error('LOCAL_RESEARCH_SNAPSHOT_ID_INVALID');
    }
    const limit = input.limit ?? 256;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('LOCAL_RESEARCH_READ_LIMIT_INVALID');
    }
    const parameters = input.snapshotId === undefined
      ? [input.decisionCycleId, input.family, limit + 1]
      : [input.decisionCycleId, input.family, input.snapshotId, limit + 1];
    const rows = this.database.prepare(`SELECT * FROM research_batch
      WHERE decision_cycle_id=? AND family=? ${input.snapshotId === undefined ? '' : 'AND snapshot_id=?'}
      ORDER BY observed_at,batch_id LIMIT ?`).all(...parameters) as unknown as BatchRow[];
    if (rows.length > limit) throw new Error('LOCAL_RESEARCH_READ_LIMIT_EXCEEDED');
    return rows.map((row) => {
      let parsed: unknown;
      try { parsed = JSON.parse(row.payload_json); }
      catch { throw new Error(`LOCAL_RESEARCH_BATCH_PAYLOAD_INVALID:${row.batch_id}`); }
      if (!Array.isArray(parsed) || parsed.length !== row.row_count
        || sha256(canonicalJson(parsed)) !== row.payload_hash) {
        throw new Error(`LOCAL_RESEARCH_BATCH_PAYLOAD_INTEGRITY_FAILED:${row.batch_id}`);
      }
      return { receipt: rowReceipt(row), payload: parsed as T[] };
    });
  }

  stats(): LocalResearchSpoolStats {
    const row = this.database.prepare(`SELECT
      count(*) AS total_batch_count,
      sum(CASE WHEN storage_state='PENDING_PARQUET' THEN 1 ELSE 0 END) AS pending_batch_count,
      sum(CASE WHEN storage_state='ARCHIVED_PARQUET' THEN 1 ELSE 0 END) AS archived_batch_count,
      min(CASE WHEN storage_state='PENDING_PARQUET' THEN observed_at END) AS oldest_pending_observed_at,
      max(CASE WHEN storage_state='PENDING_PARQUET' THEN observed_at END) AS newest_pending_observed_at
      FROM research_batch`).get() as {
        total_batch_count: number;
        pending_batch_count: number | null;
        archived_batch_count: number | null;
        oldest_pending_observed_at: string | null;
        newest_pending_observed_at: string | null;
      };
    return {
      totalBatchCount: Number(row.total_batch_count),
      pendingParquetBatchCount: Number(row.pending_batch_count ?? 0),
      archivedParquetBatchCount: Number(row.archived_batch_count ?? 0),
      oldestPendingObservedAt: row.oldest_pending_observed_at,
      newestPendingObservedAt: row.newest_pending_observed_at,
    };
  }

  verify(): { readonly valid: boolean; readonly checked: number; readonly invalidBatchIds: readonly string[] } {
    const rows = this.database.prepare('SELECT * FROM research_batch ORDER BY observed_at,batch_id')
      .all() as unknown as BatchRow[];
    const invalid: string[] = [];
    for (const row of rows) {
      let payload: unknown;
      try { payload = JSON.parse(row.payload_json); } catch { invalid.push(row.batch_id); continue; }
      if (!Array.isArray(payload) || payload.length !== row.row_count
        || sha256(canonicalJson(payload)) !== row.payload_hash) invalid.push(row.batch_id);
    }
    return { valid: invalid.length === 0, checked: rows.length, invalidBatchIds: invalid };
  }
}
