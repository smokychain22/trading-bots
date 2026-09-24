import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
