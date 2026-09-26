import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildContractPathObservationReceipt } from '../src/research/contract-path-observation-runtime.js';
import { archiveContractPathObservation } from '../src/storage/contract-path-local-archive.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';

function observation() {
  return buildContractPathObservationReceipt({
    observationJobId: 'job-1', subjectId: 'a'.repeat(64), checkpoint: '15M',
    targetAt: '2026-09-25T15:00:00Z', actualObservedAt: '2026-09-25T15:01:00Z',
    expectedLegs: [{ optionSymbol: 'SPY261120P00500000', side: 'SHORT', optionType: 'PUT',
      expiration: '2026-11-20', strike: 500, multiplier: 100 }],
    quotes: [{ optionSymbol: 'SPY261120P00500000', bid: 2, ask: 2.1,
      providerTimestamp: '2026-09-25T15:00:59Z', receivedAt: '2026-09-25T15:01:00Z',
      impliedVolatility: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1,
      provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [] }],
    underlying: { symbol: 'SPY', price: 550, providerTimestamp: '2026-09-25T15:00:58Z',
      receivedAt: '2026-09-25T15:01:00Z', provider: 'ALPACA', purpose: 'RESEARCH_REFERENCE_ONLY' },
    sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40),
  });
}

test('contract path archive is SQLite-idempotent, hash verified, and research-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-contract-path-archive-'));
  const path = join(root, 'research.sqlite');
  try {
    const input = { spoolPath: path, decisionCycleId: 'cycle-1', observation: observation() };
    const first = archiveContractPathObservation(input);
    const second = archiveContractPathObservation(input);
    assert.deepEqual(first, second);
    assert.equal(first.executionTruthClass, 'MARKET_OBSERVED');
    assert.equal(first.brokerAuthority, false);
    const spool = new LocalResearchHistorySpool(path);
    try {
      assert.equal(spool.stats().totalBatchCount, 1);
      assert.deepEqual(spool.verify(), { valid: true, checked: 1, invalidBatchIds: [] });
    } finally { spool.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
