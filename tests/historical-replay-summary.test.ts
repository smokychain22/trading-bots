import assert from 'node:assert/strict';
import test from 'node:test';
import { hashJson, type JsonValue } from '../src/market/fusion-snapshot.js';
import { historicalReplayExportVersion, type HistoricalReplayExportArtifact } from '../src/research/historical-replay-export.js';
import { summarizeHistoricalReplay } from '../src/research/historical-replay-summary.js';

function artifact(): HistoricalReplayExportArtifact {
  const body = {
    contractVersion: historicalReplayExportVersion,
    canonicalSourceSha: 'a'.repeat(40),
    generatedAt: '2026-09-22T12:00:00Z',
    sourceSessions: ['2026-09-21'],
    sourceWindow: { timezone: 'America/New_York' as const, sessionDates: ['2026-09-21'] },
    scope: 'SYMBOL_SCOPED' as const,
    providerAuthorities: ['ALPACA_EXECUTABLE_MARKET', 'THETA_PERSISTED_DECISION'] as const,
    sanitized: true as const,
    brokerAuthority: false as const,
    rowCount: 1,
    symbolCount: 1,
    immutableEvidenceIdCount: 1,
    importIssueCount: 0,
    rows: [{
      candidateId: 'candidate-1', cycleId: 'cycle-1', asOf: '2026-09-21T15:00:00Z',
      symbol: 'SPY', strategy: 'THETA_CONVENTIONAL', dte: 30, strike: 650, delta: -0.2,
      bid: 1.2, ask: 1.4, quoteProviderTimestamp: '2026-09-21T14:58:00Z',
      quoteReceivedAt: '2026-09-21T14:58:01Z', executable: false,
      rejectionCodes: ['CONTRACT_NOT_EXECUTABLE', 'QUOTE_STALE'], eventState: 'UNKNOWN',
      aegisState: 'ABSENT_IN_HISTORICAL_SCHEMA', sizingState: 'ZERO_QUANTITY', selectedQty: 0,
      economicDisposition: 'PASS', persistedEvidenceIds: ['candidate-1'],
    }],
  };
  return { ...body, contentHash: hashJson(body as unknown as JsonValue) };
}

test('real replay summary counts quote ages and overlapping reasons without inventing regret', () => {
  const summary = summarizeHistoricalReplay(artifact());
  assert.equal(summary.rowCount, 1);
  assert.equal(summary.sessions[0]?.sessionDate, '2026-09-21');
  assert.equal(summary.sessions[0]?.quoteAgeSeconds.p95, 120);
  assert.equal(summary.sessions[0]?.rejectionCodeCounts.QUOTE_STALE, 1);
  assert.equal(summary.sessions[0]?.rejectionCodeCounts.CONTRACT_NOT_EXECUTABLE, 1);
  assert.equal(summary.sessions[0]?.aegisUnobservedCount, 1);
  assert.equal(summary.sessions[0]?.eventContextObservedCount, 0);
  assert.equal(summary.sessions[0]?.eventSafetyCoverageNotEstablishedCount, 1);
  assert.equal(summary.falseRejectRate, null);
  assert.equal(summary.waitRegret, null);
});

test('tampered replay rows cannot produce a verified summary', () => {
  const source = artifact();
  const row = source.rows[0];
  assert.ok(row);
  assert.throws(() => summarizeHistoricalReplay({ ...source, rows: [{ ...row, selectedQty: 1 }] }),
    /HISTORICAL_REPLAY_EXPORT_HASH_MISMATCH/);
});

test('a row outside the declared market session is rejected', () => {
  const source = artifact();
  const row = source.rows[0];
  assert.ok(row);
  const body = { ...source, rows: [{ ...row, asOf: '2026-09-22T15:00:00Z' }] };
  const hashBody = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'contentHash'));
  const changed = { ...body, contentHash: hashJson(hashBody as JsonValue) };
  assert.throws(() => summarizeHistoricalReplay(changed), /HISTORICAL_REPLAY_EXPORT_ROW_OUTSIDE_SESSION_SET/);
});
