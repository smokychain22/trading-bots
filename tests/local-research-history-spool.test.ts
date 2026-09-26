import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';

function researchInput(overrides: Partial<Parameters<LocalResearchHistorySpool['append']>[0]> = {}) {
  return {
    batchId: 'batch-secret-key', family: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE' as const,
    sourceSha: 'a'.repeat(40), decisionCycleId: 'cycle-1', snapshotId: 'snapshot-1',
    observedAt: '2026-09-25T14:30:00.000Z', rowCount: 1,
    payload: [{ candidateId: 'candidate-1' }], ...overrides,
  };
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-spool-'));
  const spool = new LocalResearchHistorySpool(join(root, 'research.sqlite'));
  return { spool, cleanup: () => { spool.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('local research spool is immutable, idempotent, hash-verified, and never broker-authoritative', () => {
  const { spool, cleanup } = harness();
  try {
    const input = {
      batchId: 'batch-1', family: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE' as const,
      sourceSha: 'a'.repeat(40), decisionCycleId: 'cycle-1', snapshotId: 'snapshot-1',
      observedAt: '2026-09-25T14:30:00.000Z', rowCount: 2,
      payload: [{ candidateId: 'a', executionAuthorized: false }, { candidateId: 'b', executionAuthorized: false }],
    };
    const first = spool.append(input);
    const second = spool.append(input);
    assert.deepEqual(second, first);
    assert.equal(first.storageState, 'PENDING_PARQUET');
    assert.equal(first.brokerAuthority, false);
    assert.equal(spool.pending().length, 1);
    assert.deepEqual([...spool.batchIds()], ['batch-1']);
    assert.deepEqual(spool.stats(), {
      totalBatchCount: 1,
      pendingParquetBatchCount: 1,
      archivedParquetBatchCount: 0,
      oldestPendingObservedAt: input.observedAt,
      newestPendingObservedAt: input.observedAt,
    });
    assert.deepEqual(spool.verify(), { valid: true, checked: 1, invalidBatchIds: [] });
    assert.throws(() => spool.append({ ...input, rowCount: 1 }), /IDENTITY_CONFLICT|ROW_COUNT_MISMATCH/);
  } finally { cleanup(); }
});

test('local research spool rejects payload count mismatch and invalid source lineage', () => {
  const { spool, cleanup } = harness();
  try {
    const base = { batchId: 'batch-1', family: 'CANONICAL_STRATEGY_CANDIDATE_EVIDENCE' as const,
      sourceSha: 'a'.repeat(40), decisionCycleId: 'cycle-1', snapshotId: 'snapshot-1',
      observedAt: '2026-09-25T14:30:00.000Z', rowCount: 1, payload: [] };
    assert.throws(() => spool.append(base), /PAYLOAD_ROW_COUNT_MISMATCH/);
    assert.throws(() => spool.append({ ...base, sourceSha: 'unknown', rowCount: 0 }), /SOURCE_SHA_INVALID/);
  } finally { cleanup(); }
});

test('local research spool rejects secret-shaped keys and values before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-spool-secret-'));
  const spool = new LocalResearchHistorySpool(join(root, 'research.sqlite'));
  try {
    assert.throws(() => spool.append(researchInput({ payload: [{ apiKey: 'must-not-persist' }] })),
      /LOCAL_RESEARCH_SECRET_KEY_REJECTED/);
    assert.throws(() => spool.append(researchInput({
      batchId: 'batch-secret-value',
      payload: [{ note: 'postgresql://user:password@host.invalid/db' }],
    })), /LOCAL_RESEARCH_SECRET_VALUE_REJECTED/);
    assert.deepEqual(spool.verify(), { valid: true, checked: 0, invalidBatchIds: [] });
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('local research spool persists contract path observations without granting broker authority', () => {
  const { spool, cleanup } = harness();
  try {
    const receipt = spool.append({
      batchId: 'path-observation-1', family: 'CONTRACT_PATH_OBSERVATION', sourceSha: 'b'.repeat(40),
      decisionCycleId: 'cycle-1', snapshotId: 'subject-1', observedAt: '2026-09-25T15:30:00.000Z',
      rowCount: 1, payload: [{ executionTruthClass: 'MARKET_OBSERVED', brokerFill: false,
        modeledExecutionPnl: null, brokerActualPnl: null }],
    });
    assert.equal(receipt.family, 'CONTRACT_PATH_OBSERVATION');
    assert.equal(receipt.brokerAuthority, false);
    assert.deepEqual(spool.verify(), { valid: true, checked: 1, invalidBatchIds: [] });
  } finally { cleanup(); }
});

test('existing v1 SQLite spool upgrades its family constraint without losing rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-research-spool-upgrade-'));
  const path = join(root, 'research.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE research_batch(
    batch_id TEXT PRIMARY KEY,
    family TEXT NOT NULL CHECK(family IN ('CANONICAL_STRATEGY_CANDIDATE_EVIDENCE')),
    source_sha TEXT NOT NULL,decision_cycle_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,row_count INTEGER NOT NULL CHECK(row_count >= 0),payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,storage_state TEXT NOT NULL CHECK(storage_state IN ('PENDING_PARQUET','ARCHIVED_PARQUET')),
    archived_manifest_hash TEXT,created_at TEXT NOT NULL,
    UNIQUE(family,decision_cycle_id,snapshot_id,payload_hash));
    INSERT INTO research_batch VALUES('old','CANONICAL_STRATEGY_CANDIDATE_EVIDENCE','${'a'.repeat(40)}',
      'cycle-old','snapshot-old','2026-09-25T14:30:00.000Z',0,'[]',
      '${'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e78a04efc29e8b91cd9b945'}','PENDING_PARQUET',NULL,
      '2026-09-25T14:30:00.000Z');`);
  legacy.close();
  const spool = new LocalResearchHistorySpool(path);
  try {
    assert.deepEqual([...spool.batchIds()], ['old']);
    const added = spool.append({
      batchId: 'new', family: 'CONTRACT_PATH_OBSERVATION', sourceSha: 'b'.repeat(40),
      decisionCycleId: 'cycle-new', snapshotId: 'snapshot-new', observedAt: '2026-09-25T15:30:00.000Z',
      rowCount: 0, payload: [],
    });
    assert.equal(added.family, 'CONTRACT_PATH_OBSERVATION');
    assert.equal(spool.stats().totalBatchCount, 2);
  } finally {
    spool.close();
    rmSync(root, { recursive: true, force: true });
  }
});
