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

test('provider publication before the decision does not backdate THETA observation', () => {
  const event = normalizeEventEvidence(raw, '2025-01-15T12:00:30Z');
  assert.equal(event.verificationState, 'INVALID');
  assert.ok(event.reasons.includes('NOT_OBSERVED_AT_DECISION'));
});

test('duplicate identity with conflicting event time is retained and flagged', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const second = normalizeEventEvidence({ ...raw, eventTime: '2025-02-02T21:00:00Z', payloadHash: 'b'.repeat(64) }, '2025-01-16T00:00:00Z');
  const result = reconcileEventEvidence([first, second]);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.verificationState === 'CONFLICT'));
});

test('same event ID and date with a changed payload is not silently collapsed', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const revised = normalizeEventEvidence({ ...raw, payloadHash: 'b'.repeat(64) }, '2025-01-16T00:00:00Z');
  const result = reconcileEventEvidence([first, revised]);
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.verificationState === 'CONFLICT'));
  assert.ok(result.every((item) => item.reasons.includes('CONFLICTING_PROVIDER_EVENT')));
});

test('identical repeated event evidence remains a single observation', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  assert.deepEqual(reconcileEventEvidence([first, first]), [first]);
});

test('a PIT-invalid duplicate cannot be erased by page ordering', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const future = normalizeEventEvidence({ ...raw, observedAt: '2025-01-17T00:00:00Z' }, '2025-01-16T00:00:00Z');
  const forward = reconcileEventEvidence([first, future]);
  assert.deepEqual(forward, reconcileEventEvidence([future, first]));
  assert.equal(forward.length, 2);
  assert.ok(forward.every((event) => event.verificationState === 'CONFLICT'));
  assert.ok(forward.some((event) => event.reasons.includes('NOT_OBSERVED_AT_DECISION')));
});

test('consistent repeated observation keeps first observed time independent of page order', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const later = normalizeEventEvidence({ ...raw, observedAt: '2025-01-15T13:00:00Z' }, '2025-01-16T00:00:00Z');
  assert.deepEqual(reconcileEventEvidence([later, first]), [first]);
  assert.deepEqual(reconcileEventEvidence([first, later]), [first]);
});

test('changed provider-known time remains conflicting evidence', () => {
  const first = normalizeEventEvidence(raw, '2025-01-16T00:00:00Z');
  const changed = normalizeEventEvidence({ ...raw, knownAt: '2025-01-15T11:59:00Z' }, '2025-01-16T00:00:00Z');
  assert.ok(reconcileEventEvidence([first, changed]).every((event) => event.verificationState === 'CONFLICT'));
});
