/**
 * COMMAND 5C-7 items 16-17. Durable RESEARCH-SIDE persistence for the
 * model registry, selection-bias campaign receipts, and shadow
 * prediction/failure receipts -- Command 4's `EmpiricalModelRegistry` /
 * `selection-bias-receipt.ts` / `shadow-prediction-receipt.ts` are
 * correct in-memory contracts but not durable across process restarts.
 *
 * This store is a LOCAL research SQLite database, following the exact
 * pattern already established in `local-research-history-spool.ts`
 * (`node:sqlite`, WAL journal mode, hash-verified append-only rows,
 * `UNIQUE` constraints that make identical re-writes idempotent and
 * conflicting re-writes a hard error). It is NOT a Production PostgreSQL
 * table -- no migration is required, and nothing here can be reached by
 * `canonical-decision-authority.ts`/`management-action-frontier.ts`/AEGIS/
 * sizing. `brokerAuthority` is always `false`.
 *
 * Immutability: every row is keyed by its own natural identity
 * (`modelId+modelVersion`, `researchCampaignId`, `predictionId`/
 * `failureId`). A second write with an identical hash is a no-op; a
 * second write with a DIFFERENT hash under the same identity throws --
 * there is no UPDATE path in this module, matching
 * `EmpiricalModelRegistry`'s "no mutable latest pointer" invariant.
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import type { ModelRegistryRecord } from '../research/empirical-model-registry.js';
import type { SelectionBiasReceipt } from '../research/selection-bias-receipt.js';
import type { ShadowFailureReceipt, ShadowPredictionReceipt } from '../research/shadow-prediction-receipt.js';

export const researchDurableStoreVersion = 'theta-research-durable-store-v1' as const;

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function assertSafeId(name: string, value: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`RESEARCH_DURABLE_STORE_${name.toUpperCase()}_INVALID`);
}

/**
 * Generic immutable-append helper shared by all three tables below: throws
 * `IDENTITY_CONFLICT` on a genuine content mismatch under the same key,
 * and is a silent idempotent no-op on an identical re-write.
 */
function upsertImmutable(
  db: DatabaseSync,
  table: string,
  keyColumns: readonly string[],
  keyValues: readonly string[],
  contentJson: string,
  contentHash: string,
  insertSql: string,
  insertParams: readonly SQLInputValue[],
): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
  const whereClause = keyColumns.map((c) => `${c}=?`).join(' AND ');
  const existing = db.prepare(`SELECT content_hash FROM ${table} WHERE ${whereClause}`)
    .get(...keyValues) as { content_hash: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_hash !== contentHash) {
      throw new Error(`RESEARCH_DURABLE_STORE_IDENTITY_CONFLICT:${table}:${keyValues.join('::')}`);
    }
    return 'ALREADY_PRESENT_IDENTICAL';
  }
  db.prepare(insertSql).run(...insertParams);
  return 'INSERTED';
}

export class ResearchDurableStore {
  private readonly database: DatabaseSync;

  constructor(path = '.theta-local-worker/research-spool/theta-research-durable.sqlite') {
    const databasePath = resolve(path);
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS model_registry_record(
        model_id TEXT NOT NULL, model_version TEXT NOT NULL,
        content_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(model_id, model_version));
      CREATE TABLE IF NOT EXISTS selection_bias_receipt(
        research_campaign_id TEXT NOT NULL PRIMARY KEY,
        content_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shadow_prediction_receipt(
        prediction_id TEXT NOT NULL PRIMARY KEY,
        content_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shadow_failure_receipt(
        failure_id TEXT NOT NULL PRIMARY KEY,
        content_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }

  close(): void { this.database.close(); }

  /**
   * ADVERSARIAL HARDENING (overnight wave §21): a challenger record's
   * `baselineModelId` is checked at construction time
   * (`empirical-model-registry.ts`) to be non-null, but that check alone
   * cannot prove the referenced baseline actually EXISTS anywhere durable
   * -- a caller could construct a syntactically valid challenger pointing
   * at a baseline that was never saved. This closes that gap: persistence
   * itself now refuses a challenger whose baseline isn't a real, already-
   * durable record, and refuses a baseline model's OWN identity from being
   * referenced before it exists (write order matters).
   */
  saveModelRecord(record: ModelRegistryRecord): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    assertSafeId('modelId', record.modelId);
    assertSafeId('modelVersion', record.modelVersion);
    if (!record.isBaseline && record.baselineModelId !== null) {
      const baselineVersions = this.listModelVersions(record.baselineModelId);
      if (baselineVersions.length === 0) {
        throw new Error(`RESEARCH_DURABLE_STORE_BASELINE_NOT_FOUND:${record.baselineModelId}`);
      }
    }
    const json = canonicalJson(record);
    const hash = sha256(json);
    return upsertImmutable(
      this.database, 'model_registry_record', ['model_id', 'model_version'],
      [record.modelId, record.modelVersion], json, hash,
      `INSERT INTO model_registry_record(model_id,model_version,content_json,content_hash,created_at) VALUES(?,?,?,?,?)`,
      [record.modelId, record.modelVersion, json, hash, new Date().toISOString()],
    );
  }

  getModelRecord(modelId: string, modelVersion: string): ModelRegistryRecord | null {
    const row = this.database.prepare(
      'SELECT content_json FROM model_registry_record WHERE model_id=? AND model_version=?',
    ).get(modelId, modelVersion) as { content_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.content_json) as ModelRegistryRecord);
  }

  listModelVersions(modelId: string): readonly string[] {
    const rows = this.database.prepare('SELECT model_version FROM model_registry_record WHERE model_id=?')
      .all(modelId) as unknown as Array<{ model_version: string }>;
    return rows.map((r) => r.model_version);
  }

  saveSelectionBiasReceipt(receipt: SelectionBiasReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    assertSafeId('researchCampaignId', receipt.researchCampaignId);
    const json = canonicalJson(receipt);
    const hash = sha256(json);
    return upsertImmutable(
      this.database, 'selection_bias_receipt', ['research_campaign_id'], [receipt.researchCampaignId], json, hash,
      `INSERT INTO selection_bias_receipt(research_campaign_id,content_json,content_hash,created_at) VALUES(?,?,?,?)`,
      [receipt.researchCampaignId, json, hash, new Date().toISOString()],
    );
  }

  getSelectionBiasReceipt(researchCampaignId: string): SelectionBiasReceipt | null {
    const row = this.database.prepare('SELECT content_json FROM selection_bias_receipt WHERE research_campaign_id=?')
      .get(researchCampaignId) as { content_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.content_json) as SelectionBiasReceipt);
  }

  saveShadowPredictionReceipt(receipt: ShadowPredictionReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    assertSafeId('predictionId', receipt.predictionId);
    const json = canonicalJson(receipt);
    const hash = sha256(json);
    return upsertImmutable(
      this.database, 'shadow_prediction_receipt', ['prediction_id'], [receipt.predictionId], json, hash,
      `INSERT INTO shadow_prediction_receipt(prediction_id,content_json,content_hash,created_at) VALUES(?,?,?,?)`,
      [receipt.predictionId, json, hash, new Date().toISOString()],
    );
  }

  /** Real read accessor -- was missing until the overnight §20
   * reproducibility-bundle work needed to independently verify a
   * referenced prediction receipt actually exists, not merely trust a
   * caller's ID string. */
  getShadowPredictionReceipt(predictionId: string): ShadowPredictionReceipt | null {
    const row = this.database.prepare('SELECT content_json FROM shadow_prediction_receipt WHERE prediction_id=?')
      .get(predictionId) as { content_json: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.content_json) as ShadowPredictionReceipt);
  }

  saveShadowFailureReceipt(receipt: ShadowFailureReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    assertSafeId('failureId', receipt.failureId);
    const json = canonicalJson(receipt);
    const hash = sha256(json);
    return upsertImmutable(
      this.database, 'shadow_failure_receipt', ['failure_id'], [receipt.failureId], json, hash,
      `INSERT INTO shadow_failure_receipt(failure_id,content_json,content_hash,created_at) VALUES(?,?,?,?)`,
      [receipt.failureId, json, hash, new Date().toISOString()],
    );
  }

  /** Verifies every stored row's content hash against its stored JSON --
   * proves the store has not been silently corrupted or hand-edited. */
  verify(): { readonly valid: boolean; readonly checked: number; readonly invalidKeys: readonly string[] } {
    const tables: readonly { table: string; keyCols: readonly string[] }[] = [
      { table: 'model_registry_record', keyCols: ['model_id', 'model_version'] },
      { table: 'selection_bias_receipt', keyCols: ['research_campaign_id'] },
      { table: 'shadow_prediction_receipt', keyCols: ['prediction_id'] },
      { table: 'shadow_failure_receipt', keyCols: ['failure_id'] },
    ];
    const invalid: string[] = [];
    let checked = 0;
    for (const { table, keyCols } of tables) {
      const rows = this.database.prepare(`SELECT ${keyCols.join(',')}, content_json, content_hash FROM ${table}`)
        .all() as unknown as Array<Record<string, string> & { content_json: string; content_hash: string }>;
      for (const row of rows) {
        checked += 1;
        const key = keyCols.map((c) => row[c] ?? '').join('::');
        if (sha256(row.content_json) !== row.content_hash) invalid.push(`${table}:${key}`);
      }
    }
    return { valid: invalid.length === 0, checked, invalidKeys: invalid };
  }
}
