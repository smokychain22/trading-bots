import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  sanitizeLocalRuntimeReceipt,
  writeLocalRuntimeReceipt,
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
