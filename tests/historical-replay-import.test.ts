import assert from 'node:assert/strict';
import test from 'node:test';
import { importHistoricalReplayBatch } from '../src/research/historical-replay-import.js';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateId: 'AAPL-c1', cycleId: 'cycle-1', asOf: '2026-09-21T14:00:00Z', symbol: 'AAPL',
    strategy: 'THETA_CONVENTIONAL', dte: 30, strike: 190, delta: -0.22, bid: 1.5, ask: 1.6,
    quoteProviderTimestamp: '2026-09-21T13:59:00Z', quoteReceivedAt: '2026-09-21T13:59:30Z',
    executable: false, rejectionCodes: ['CONTRACT_NOT_EXECUTABLE'], eventState: 'CLEAR',
    aegisState: 'ABSENT_IN_HISTORICAL_SCHEMA', sizingState: 'ABSENT_IN_HISTORICAL_SCHEMA', selectedQty: null,
    economicDisposition: 'ABSENT_IN_HISTORICAL_SCHEMA', persistedEvidenceIds: ['ev-1'], ...overrides,
  };
}

test('accepts a real, well-formed historical row', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [row()]);
  assert.equal(result.rowsAccepted.length, 1);
  assert.equal(result.issues.length, 0);
});

test('ABSENT_IN_HISTORICAL_SCHEMA is a real, distinct accepted value, never coerced to null', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [row()]);
  assert.equal(result.rowsAccepted[0]?.aegisState, 'ABSENT_IN_HISTORICAL_SCHEMA');
});

test('malformed row is rejected with SCHEMA_INVALID, not silently dropped', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [{ candidateId: 'bad' }]);
  assert.equal(result.rowsAccepted.length, 0);
  assert.equal(result.issues[0]?.code, 'SCHEMA_INVALID');
});

test('duplicate candidateId within one batch is rejected as DUPLICATE_CANDIDATE_ID', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [row(), row()]);
  assert.equal(result.rowsAccepted.length, 1);
  assert.equal(result.issues[0]?.code, 'DUPLICATE_CANDIDATE_ID');
});

test('ADVERSARIAL: a quote timestamp AFTER asOf is a real PIT violation, row rejected', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [
    row({ quoteProviderTimestamp: '2026-09-21T15:00:00Z' }),
  ]);
  assert.equal(result.rowsAccepted.length, 0);
  assert.equal(result.issues[0]?.code, 'PIT_TIMESTAMP_FUTURE');
});

test('a row with empty persistedEvidenceIds is still accepted but flagged EVIDENCE_INCOMPLETE', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [row({ persistedEvidenceIds: [] })]);
  assert.equal(result.rowsAccepted.length, 1);
  assert.equal(result.issues[0]?.code, 'EVIDENCE_INCOMPLETE');
});

test('an invalid asOf timestamp is rejected (caught by schema validation, not silently accepted)', () => {
  const result = importHistoricalReplayBatch('2026-09-21', [row({ asOf: 'not-a-date' })]);
  assert.equal(result.rowsAccepted.length, 0);
  assert.equal(result.issues[0]?.code, 'SCHEMA_INVALID');
});
