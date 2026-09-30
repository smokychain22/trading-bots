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
import { validateModelRegistryRecord, type ModelRegistryRecord } from '../research/empirical-model-registry.js';
import { buildSelectionBiasReceipt, selectionBiasReceiptVersion, type SelectionBiasReceipt } from '../research/selection-bias-receipt.js';
import { buildShadowFailureReceipt, buildShadowPredictionReceipt, shadowPredictionReceiptVersion, type ShadowFailureReceipt, type ShadowPredictionReceipt } from '../research/shadow-prediction-receipt.js';
import { joinPredictionToOutcome, type OutcomeEvidence, type PredictionOutcomeJoinRecord } from '../research/prediction-outcome-join.js';

export const researchDurableStoreVersion = 'theta-research-durable-store-v1' as const;

const SAFE_ID = /^[A-Za-z0-9_.:@/-]{1,512}$/;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function assertSafeId(name: string, value: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`RESEARCH_DURABLE_STORE_${name.toUpperCase()}_INVALID`);
}

function decodeVerified<T>(row: { content_json: string; content_hash: string } | undefined,
  identity: Readonly<Record<string, string>>): T | null {
  if (row === undefined) return null;
  if (sha256(row.content_json) !== row.content_hash) throw new Error('RESEARCH_DURABLE_STORE_HASH_MISMATCH');
  const value = JSON.parse(row.content_json) as Record<string, unknown>;
  if (value === null || typeof value !== 'object' || Object.entries(identity).some(([key, id]) => value[key] !== id)) {
    throw new Error('RESEARCH_DURABLE_STORE_IDENTITY_MISMATCH');
  }
  return value as T;
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
  const existing = db.prepare(`SELECT content_json, content_hash FROM ${table} WHERE ${whereClause}`)
    .get(...keyValues) as { content_json: string; content_hash: string } | undefined;
  if (existing !== undefined) {
    decodeVerified(existing, {});
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
      CREATE TABLE IF NOT EXISTS prediction_outcome_join(
        prediction_id TEXT NOT NULL, joined_at TEXT NOT NULL,
        content_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(prediction_id, joined_at));
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
    validateModelRegistryRecord(record);
    if (!record.isBaseline && record.baselineModelId !== null) {
      if (!record.baselineModelVersion) throw new Error('MODEL_REGISTRY_EXACT_BASELINE_REQUIRED');
      const baseline = this.getModelRecord(record.baselineModelId, record.baselineModelVersion);
      if (baseline === null) {
        throw new Error(`RESEARCH_DURABLE_STORE_BASELINE_NOT_FOUND:${record.baselineModelId}`);
      }
      if (!baseline.isBaseline || baseline.targetId !== record.targetId) throw new Error('RESEARCH_DURABLE_STORE_BASELINE_INCOMPATIBLE');
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
      'SELECT content_json, content_hash FROM model_registry_record WHERE model_id=? AND model_version=?',
    ).get(modelId, modelVersion) as { content_json: string; content_hash: string } | undefined;
    const record = decodeVerified<ModelRegistryRecord>(row, { modelId, modelVersion });
    if (record !== null) validateModelRegistryRecord(record);
    return record;
  }

  listModelVersions(modelId: string): readonly string[] {
    const rows = this.database.prepare('SELECT model_version FROM model_registry_record WHERE model_id=?')
      .all(modelId) as unknown as Array<{ model_version: string }>;
    return rows.map((r) => r.model_version).sort();
  }

  saveSelectionBiasReceipt(receipt: SelectionBiasReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    if (receipt.contractVersion !== selectionBiasReceiptVersion) throw new Error('RESEARCH_SELECTION_VERSION_INVALID');
    buildSelectionBiasReceipt(receipt);
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
    const row = this.database.prepare('SELECT content_json, content_hash FROM selection_bias_receipt WHERE research_campaign_id=?')
      .get(researchCampaignId) as { content_json: string; content_hash: string } | undefined;
    const receipt = decodeVerified<SelectionBiasReceipt>(row, { researchCampaignId });
    if (receipt !== null) {
      if (receipt.contractVersion !== selectionBiasReceiptVersion) throw new Error('RESEARCH_SELECTION_VERSION_INVALID');
      buildSelectionBiasReceipt(receipt);
    }
    return receipt;
  }

  saveShadowPredictionReceipt(receipt: ShadowPredictionReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    if (receipt.contractVersion !== shadowPredictionReceiptVersion || receipt.brokerAuthority !== false || receipt.shadowOnly !== true) throw new Error('RESEARCH_PREDICTION_AUTHORITY_INVALID');
    buildShadowPredictionReceipt(receipt);
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
    const row = this.database.prepare('SELECT content_json, content_hash FROM shadow_prediction_receipt WHERE prediction_id=?')
      .get(predictionId) as { content_json: string; content_hash: string } | undefined;
    const receipt = decodeVerified<ShadowPredictionReceipt>(row, { predictionId });
    if (receipt !== null) {
      if (receipt.contractVersion !== shadowPredictionReceiptVersion || receipt.brokerAuthority !== false || receipt.shadowOnly !== true) throw new Error('RESEARCH_PREDICTION_AUTHORITY_INVALID');
      buildShadowPredictionReceipt(receipt);
    }
    return receipt;
  }

  saveShadowFailureReceipt(receipt: ShadowFailureReceipt): 'INSERTED' | 'ALREADY_PRESENT_IDENTICAL' {
    if (receipt.contractVersion !== shadowPredictionReceiptVersion || receipt.brokerAuthority !== false || receipt.shadowOnly !== true) throw new Error('RESEARCH_FAILURE_AUTHORITY_INVALID');
    buildShadowFailureReceipt(receipt);
    assertSafeId('failureId', receipt.failureId);
    const json = canonicalJson(receipt);
    const hash = sha256(json);
    return upsertImmutable(
      this.database, 'shadow_failure_receipt', ['failure_id'], [receipt.failureId], json, hash,
      `INSERT INTO shadow_failure_receipt(failure_id,content_json,content_hash,created_at) VALUES(?,?,?,?)`,
      [receipt.failureId, json, hash, new Date().toISOString()],
    );
  }

  getShadowFailureReceipt(failureId: string): ShadowFailureReceipt | null {
    const row = this.database.prepare('SELECT content_json, content_hash FROM shadow_failure_receipt WHERE failure_id=?')
      .get(failureId) as { content_json: string; content_hash: string } | undefined;
    const receipt = decodeVerified<ShadowFailureReceipt>(row, { failureId });
    if (receipt !== null) {
      if (receipt.contractVersion !== shadowPredictionReceiptVersion || receipt.brokerAuthority !== false || receipt.shadowOnly !== true) throw new Error('RESEARCH_FAILURE_AUTHORITY_INVALID');
      buildShadowFailureReceipt(receipt);
    }
    return receipt;
  }

  savePredictionOutcomeJoin(predictionId: string, outcome: OutcomeEvidence, joinedAt: string): PredictionOutcomeJoinRecord {
    assertSafeId('predictionId', predictionId);
    const prediction = this.getShadowPredictionReceipt(predictionId);
    if (prediction === null) throw new Error('RESEARCH_DURABLE_STORE_PREDICTION_NOT_FOUND');
    const join = joinPredictionToOutcome(prediction, outcome, joinedAt);
    const resolved = this.getPredictionOutcomeJoins(predictionId).filter((r) => r.status === 'JOINED');
    if (resolved.some((r) => r.outcome !== join.outcome || join.status !== 'JOINED')) throw new Error('RESEARCH_DURABLE_STORE_RESOLVED_OUTCOME_CONFLICT');
    const json = canonicalJson(join);
    upsertImmutable(this.database, 'prediction_outcome_join', ['prediction_id', 'joined_at'], [predictionId, joinedAt], json, sha256(json),
      'INSERT INTO prediction_outcome_join(prediction_id,joined_at,content_json,content_hash,created_at) VALUES(?,?,?,?,?)',
      [predictionId, joinedAt, json, sha256(json), joinedAt]);
    return join;
  }

  getPredictionOutcomeJoins(predictionId: string): readonly PredictionOutcomeJoinRecord[] {
    const rows = this.database.prepare('SELECT joined_at, content_json, content_hash FROM prediction_outcome_join WHERE prediction_id=? ORDER BY joined_at')
      .all(predictionId) as unknown as Array<{ joined_at: string; content_json: string; content_hash: string }>;
    return rows.map((row) => {
      const decoded = decodeVerified<PredictionOutcomeJoinRecord>(row, { predictionId, joinedAt: row.joined_at });
      if (decoded === null) throw new Error('RESEARCH_DURABLE_STORE_JOIN_ROW_MISSING');
      return decoded;
    });
  }

  /** Verifies every stored row's content hash against its stored JSON --
   * proves the store has not been silently corrupted or hand-edited. */
  verify(): { readonly valid: boolean; readonly checked: number; readonly invalidKeys: readonly string[] } {
    const tables: readonly { table: string; keyCols: readonly string[] }[] = [
      { table: 'model_registry_record', keyCols: ['model_id', 'model_version'] },
      { table: 'selection_bias_receipt', keyCols: ['research_campaign_id'] },
      { table: 'shadow_prediction_receipt', keyCols: ['prediction_id'] },
      { table: 'shadow_failure_receipt', keyCols: ['failure_id'] },
      { table: 'prediction_outcome_join', keyCols: ['prediction_id', 'joined_at'] },
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
