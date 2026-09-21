import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_PIT_EXPORT_CONTRACT_VERSION, runEventPitRealDataStudy } from '../src/research/event-pit-real-data-runner.js';

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

test('runEventPitRealDataStudy runs the real study and tags evidenceLineage REAL_EXPORT on a valid export', () => {
  const rows = [
    {
      identityKey: 'e1', underlying: 'AAPL', eventType: 'EARNINGS', eventTime: '2026-10-20T20:00:00Z',
      providerPublishedAt: null, providerKnownAt: '2026-10-01T00:00:00Z', thetaFirstObservedAt: '2026-10-01T00:05:00Z',
      ingestedAt: '2026-10-01T00:05:00Z',
    },
    {
      identityKey: 'e2', underlying: 'MSFT', eventType: 'EARNINGS', eventTime: '2026-10-21T20:00:00Z',
      providerPublishedAt: null, providerKnownAt: null, thetaFirstObservedAt: null, ingestedAt: null,
    },
  ];
  const result = runEventPitRealDataStudy({
    exportContractVersion: EVENT_PIT_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'test fixture', rowCount: rows.length, rows,
  });
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
  }];
  const result = runEventPitRealDataStudy({
    exportContractVersion: EVENT_PIT_EXPORT_CONTRACT_VERSION, generatedAt: '2026-09-21T00:00:00Z',
    sanitized: true, sourceDescription: 'test fixture', rowCount: rows.length, rows,
  });
  assert.equal(result.conflictCount, 1);
});
