import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_PIT_EXPORT_CONTRACT_VERSION, runEventPitRealDataStudy } from '../src/research/event-pit-real-data-runner.js';
import { computeExportContentHash } from '../src/research/real-data-export-contract.js';

const CANONICAL_SHA = 'b'.repeat(40);

function exportEnvelope(rows: readonly unknown[]): Record<string, unknown> {
  return {
    exportContractVersion: EVENT_PIT_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'test fixture', provider: 'OPTIONOMICS',
    sourceWindowStart: '2026-01-01T00:00:00Z', sourceWindowEnd: '2026-09-21T00:00:00Z',
    scope: 'SYMBOL_SCOPED', symbolCount: 2, canonicalSourceSha: CANONICAL_SHA,
    evidenceIds: rows.map((_, i) => `evidence-${i}`), contentHash: computeExportContentHash(rows),
    rowCount: rows.length, rows,
  };
}

test('runEventPitRealDataStudy reports AWAITING_REAL_EXPORT when no export exists yet', () => {
  const result = runEventPitRealDataStudy(null);
  assert.equal(result.status, 'AWAITING_REAL_EXPORT');
  assert.equal(result.evidenceLineage, null);
  assert.equal(result.summary, null);
});

test('runEventPitRealDataStudy rejects a malformed export rather than running a study on it', () => {
  const result = runEventPitRealDataStudy({ exportContractVersion: 'wrong', sanitized: true, rows: [] });
  assert.equal(result.status, 'EXPORT_CONTRACT_INVALID');
});

test('runEventPitRealDataStudy rejects an export whose contentHash does not match its rows', () => {
  const rows = [{ identityKey: 'e1', underlying: 'AAPL', eventType: 'EARNINGS' }];
  const result = runEventPitRealDataStudy({ ...exportEnvelope(rows), contentHash: '0'.repeat(64) });
  assert.equal(result.status, 'EXPORT_CONTENT_HASH_MISMATCH');
});

test('runEventPitRealDataStudy runs the real study and tags evidenceLineage REAL_EXPORT on a valid export', () => {
  const rows = [
    {
      identityKey: 'e1', underlying: 'AAPL', eventType: 'EARNINGS', eventTime: '2026-10-20T20:00:00Z',
      providerPublishedAt: null, providerKnownAt: '2026-10-01T00:00:00Z', thetaFirstObservedAt: '2026-10-01T00:05:00Z',
      ingestedAt: '2026-10-01T00:05:00Z', providerTimestampIndependentlyVerified: false,
    },
    {
      identityKey: 'e2', underlying: 'MSFT', eventType: 'EARNINGS', eventTime: '2026-10-21T20:00:00Z',
      providerPublishedAt: null, providerKnownAt: null, thetaFirstObservedAt: null, ingestedAt: null,
      providerTimestampIndependentlyVerified: false,
    },
  ];
  const result = runEventPitRealDataStudy(exportEnvelope(rows));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.evidenceLineage, 'REAL_EXPORT');
  assert.equal(result.summary?.totalRows, 2);
  assert.equal(result.summary?.counts.PIT_SAFE_THETA_FIRST_OBSERVED, 1);
  assert.equal(result.summary?.counts.HISTORICAL_NOT_PIT_SAFE, 1);
  assert.equal(result.conflictCount, 0);
});

test('runEventPitRealDataStudy surfaces AMBIGUOUS rows as a distinct conflictCount', () => {
  const rows = [{
    identityKey: 'e1', underlying: 'AAPL', eventType: 'EARNINGS', eventTime: '2026-10-20T20:00:00Z',
    providerPublishedAt: null, providerKnownAt: '2026-10-25T00:00:00Z', thetaFirstObservedAt: null, ingestedAt: null,
    providerTimestampIndependentlyVerified: false,
  }];
  const result = runEventPitRealDataStudy(exportEnvelope(rows));
  assert.equal(result.conflictCount, 1);
});
