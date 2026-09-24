import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../research/point-in-time-evidence.js';

export const localResearchHistorySpoolVersion = 'theta-local-research-history-spool-v1' as const;

export type LocalResearchFamily = 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE';

export interface LocalResearchBatchInput {
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

type BatchRow = {
  batch_id: string; family: LocalResearchFamily; source_sha: string; decision_cycle_id: string;
  snapshot_id: string; observed_at: string; row_count: number; payload_json: string; payload_hash: string;
  storage_state: 'PENDING_PARQUET' | 'ARCHIVED_PARQUET'; archived_manifest_hash: string | null;
};

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

function rowReceipt(row: BatchRow): LocalResearchBatchReceipt {
  return {
    batchId: row.batch_id, family: row.family, sourceSha: row.source_sha,
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
      batch_id TEXT PRIMARY KEY,
      family TEXT NOT NULL CHECK(family IN ('CANONICAL_STRATEGY_CANDIDATE_EVIDENCE')),
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
        ON research_batch(storage_state,observed_at,batch_id);`);
  }

  close(): void { this.database.close(); }

  append(input: LocalResearchBatchInput): LocalResearchBatchReceipt {
    for (const [name, value] of [['batchId', input.batchId], ['decisionCycleId', input.decisionCycleId],
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
      if (existing.family !== input.family || existing.source_sha !== input.sourceSha
        || existing.decision_cycle_id !== input.decisionCycleId || existing.snapshot_id !== input.snapshotId
        || existing.observed_at !== observedAt.toISOString() || existing.row_count !== input.rowCount
        || existing.payload_hash !== payloadHash) throw new Error('LOCAL_RESEARCH_BATCH_IDENTITY_CONFLICT');
      return rowReceipt(existing);
    }
    this.database.prepare(`INSERT INTO research_batch(batch_id,family,source_sha,decision_cycle_id,snapshot_id,
      observed_at,row_count,payload_json,payload_hash,storage_state,archived_manifest_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'PENDING_PARQUET',NULL,?)`).run(input.batchId,input.family,input.sourceSha,
      input.decisionCycleId,input.snapshotId,observedAt.toISOString(),input.rowCount,payloadJson,payloadHash,
      new Date().toISOString());
    return {
      batchId: input.batchId, family: input.family, sourceSha: input.sourceSha,
      decisionCycleId: input.decisionCycleId, snapshotId: input.snapshotId,
      observedAt: observedAt.toISOString(), rowCount: input.rowCount, payloadHash,
      storageState: 'PENDING_PARQUET', brokerAuthority: false,
    };
  }

  pending(limit = 100): readonly LocalResearchBatchReceipt[] {
    const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
    return (this.database.prepare(`SELECT * FROM research_batch WHERE storage_state='PENDING_PARQUET'
      ORDER BY observed_at,batch_id LIMIT ?`).all(bounded) as unknown as BatchRow[]).map(rowReceipt);
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
