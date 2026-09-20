import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEventEvidence, reconcileEventEvidence } from '../src/theta/normalized-event-evidence.js';

const raw = {
  source: 'OPTIONOMICS' as const, providerEventId: 'evt-1', underlying: 'AAPL', eventType: 'EARNINGS',
  eventTime: '2025-02-01T21:00:00Z', knownAt: '2025-01-15T12:00:00Z', observedAt: '2025-01-15T12:01:00Z',
  payloadHash: 'a'.repeat(64), applicable: true,
};

test('normalizes a PIT-valid provider event', () => {
  const event = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  assert.equal(event.verificationState, 'VERIFIED');
  assert.deepEqual(event.reasons, []);
});

test('future-known event is invalid instead of leaking into a decision', () => {
  const event = normalizeEventEvidence(raw, '2025-01-14T00:00:00Z');
  assert.equal(event.verificationState, 'INVALID');
  assert.ok(event.reasons.includes('NOT_KNOWN_AT_DECISION'));
});

test('duplicate identity with conflicting event time is retained and flagged', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const second = normalizeEventEvidence({ ...raw, eventTime: '2025-02-02T21:00:00Z', payloadHash: 'b'.repeat(64) }, '2025-01-16T00:00:00Z');
  const result = reconcileEventEvidence([first, second]);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.verificationState === 'CONFLICT'));
});
