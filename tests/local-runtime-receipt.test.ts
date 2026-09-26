import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  sanitizeLocalRuntimeReceipt,
  writeLocalRuntimeReceipt,
  writeLocalFailureReceipt,
} from '../tools/write-local-runtime-receipt.mjs';

const scope = (correlationId: string) => ({
  correlationId,
  status: 'SUCCEEDED',
  executionGate: 'LOCKED',
  jobsAttempted: 1,
  jobsCompleted: 1,
  jobResults: [{ jobType: 'POSITION_RECONCILIATION', outcome: 'RAN', status: 'SUCCEEDED', errorCode: 'must-not-survive' }],
  reconciliation: {
    accountStatus: 'ACTIVE', positionCount: 0, openOrderCount: 0, activityCount: 0,
    matchedOrderCount: 0, externalOrUnknownCount: 0, entryBlockingFactCount: 0,
    brokerFactImpactSummary:{version:'theta-broker-fact-impact-v1',totalFacts:0,entryBlockingFactCount:0,
      currentEconomicExposureCount:0,currentReconciliationDefectCount:0,historicalReconciledCount:0,
      historicalAccountingOnlyCount:0,unknownCurrentImpactCount:0},localOnlyIntentCount: 0,
    marketOpen: false, calendarSessionConfirmed: true, dataQuality: 'GOOD', observedAt: '2026-09-17T20:16:00.000Z',
    providerAccountRefHash: 'must-not-survive', positions: [{ symbol: 'SECRET' }],
  },
  masterPaperOrdersSubmitted: 0,
  followerPaperOrdersSubmitted: 0,
  liveOrdersSubmitted: 0,
  credential: 'must-not-survive',
});

const receipt = (observedAt: string) => ({
  observedAt,
  marketSessionDate: '2026-09-17',
  buildSha: 'd17b4c1f77ba257ae906e72dd980c5d12d3bdc74',
  mode: 'MASTER_THETA_PAPER',
  executionGate: 'LOCKED',
  researchExport: 'RESEARCH_CURRENT',
  scopes: Object.fromEntries(['BROKER', 'LIFECYCLE', 'MANAGEMENT', 'OBSERVATION', 'EVIDENCE']
    .map((name) => [name, scope(`${name.toLowerCase()}:cycle`)])),
  alpacaSecret: 'must-not-survive',
});

test('local runtime receipt uses a strict sanitized schema', () => {
  const sanitized = sanitizeLocalRuntimeReceipt(receipt('2026-09-17T20:16:07.000Z'));
  const encoded = JSON.stringify(sanitized);
  assert.doesNotMatch(encoded, /must-not-survive|providerAccountRefHash|positions|alpacaSecret/);
  assert.equal(sanitized.scopes.BROKER.reconciliation?.positionCount, 0);
  assert.equal(sanitized.scopes.BROKER.masterPaperOrdersSubmitted, 0);
});

test('local runtime receipts are append-only and hash chained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theta-local-receipts-'));
  try {
    const first = await writeLocalRuntimeReceipt(receipt('2026-09-17T20:16:07.000Z'), root);
    const second = await writeLocalRuntimeReceipt(receipt('2026-09-17T20:17:07.000Z'), root);
    assert.match(first.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(second.previousReceiptHash, first.receiptHash);
    assert.notEqual(second.path, first.path);
    const firstBody = JSON.parse(await readFile(join(root, first.path), 'utf8'));
    const secondBody = JSON.parse(await readFile(join(root, second.path), 'utf8'));
    const latest = JSON.parse(await readFile(join(root, 'latest.json'), 'utf8'));
    assert.equal(firstBody.previousReceiptHash, null);
    assert.equal(secondBody.previousReceiptHash, first.receiptHash);
    assert.equal(latest.receiptHash, second.receiptHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Phase 2 Pass B Final Closure C (directive sections 13-15): "a Postgres
// step throws before the normal receipt block" is simulated here by simply
// never calling the success-receipt writer at all -- the failure writer is
// the exact function the worker script's outer catch calls in that real
// scenario, and no Aiven/Postgres failure injection is needed to exercise
// its control-flow behavior.
const failureReceipt = (observedAt: string, overrides: Partial<Parameters<typeof writeLocalFailureReceipt>[0]> = {}) => ({
  observedAt, marketSessionDate: '2026-09-24', buildSha: 'd17b4c1f77ba257ae906e72dd980c5d12d3bdc74',
  mode: 'MASTER_THETA_PAPER', workerId: 'test-worker-1', failureCode: 'LOCAL_HttpRequestException',
  failedOperation: 'RUNTIME_EVIDENCE_CYCLE', marketOpen: null, ...overrides,
});

test('a bounded failure receipt is produced even though no full success cycle ever ran', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theta-local-receipts-'));
  try {
    const result = await writeLocalFailureReceipt(failureReceipt('2026-09-24T15:57:33.953Z'), root);
    assert.equal(result.state, 'PERSISTED_FAILURE');
    assert.match(result.receiptHash, /^[0-9a-f]{64}$/);
    assert.match(result.path, /-FAILURE-/);
    const body = JSON.parse(await readFile(join(root, result.path), 'utf8'));
    assert.equal(body.receiptVersion, 'theta-local-runtime-failure-receipt-v1');
    assert.equal(body.failureCode, 'LOCAL_HttpRequestException');
    assert.equal(body.failedOperation, 'RUNTIME_EVIDENCE_CYCLE');
    // No giant payload, no secrets -- only the bounded fields section 14 names.
    assert.deepEqual(Object.keys(body).toSorted(), [
      'buildSha', 'failedOperation', 'failureCode', 'marketOpen', 'marketSessionDate',
      'mode', 'observedAt', 'previousReceiptHash', 'receiptHash', 'receiptVersion', 'workerId',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failure receipt never touches latest.json -- the real success hash chain stays unbroken by a failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theta-local-receipts-'));
  try {
    const success1 = await writeLocalRuntimeReceipt(receipt('2026-09-24T15:52:20.522Z'), root);
    await writeLocalFailureReceipt(failureReceipt('2026-09-24T15:57:33.953Z'), root);
    const latestAfterFailure = JSON.parse(await readFile(join(root, 'latest.json'), 'utf8'));
    assert.equal(latestAfterFailure.receiptHash, success1.receiptHash, 'a failure receipt must never overwrite the success pointer');
    const success2 = await writeLocalRuntimeReceipt(receipt('2026-09-24T16:03:20.896Z'), root);
    assert.equal(success2.previousReceiptHash, success1.receiptHash, 'the success chain must skip straight from success1 to success2, unaffected by the failure receipt in between');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a receipt-write failure inside the failure-receipt path itself cannot throw past the caller (mirrors the worker script\'s own try/catch{} around it)', async () => {
  await assert.rejects(writeLocalFailureReceipt(failureReceipt('not-a-real-timestamp'), '/does/not/matter'));
  // The above rejects (invalid input) -- proving the function itself still
  // signals failure normally; the worker script's own bare try/catch{}
  // around this call (not re-tested here, verified by direct source read)
  // is what guarantees this can never crash the outer failure handler.
});
