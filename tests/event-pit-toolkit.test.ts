import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHistoricalEventPit, computeEventIdentity, foldThetaFirstObservedAt,
  fromCanonicalEventEvidence, summarizeHistoricalEventPitStudy, wasEventKnownToThetaAtDecision,
  type EventPitRecord,
} from '../src/research/event-pit-toolkit.js';
import { normalizeEventEvidence, type RawEventEvidence } from '../src/theta/normalized-event-evidence.js';

const record = (overrides: Partial<EventPitRecord> = {}): EventPitRecord => ({
  identityKey: 'OPTIONOMICS:evt-1', underlying: 'AAPL', eventType: 'EARNINGS',
  eventTime: '2026-10-20T20:00:00Z', providerPublishedAt: null, providerKnownAt: '2026-10-01T00:00:00Z',
  thetaFirstObservedAt: null, ingestedAt: '2026-10-01T00:05:00Z', ...overrides,
});

test('computeEventIdentity prefers a real provider event ID and names the fallback basis honestly', () => {
  const withId = computeEventIdentity({ source: 'OPTIONOMICS', underlying: 'AAPL', eventFamily: 'EARNINGS', eventDateTime: '2026-10-20', providerEventId: 'abc-123' });
  assert.equal(withId.identityKey, 'OPTIONOMICS:abc-123');
  assert.equal(withId.identityBasis, 'PROVIDER_EVENT_ID');

  const withoutId = computeEventIdentity({ source: 'OPTIONOMICS', underlying: 'AAPL', eventFamily: 'EARNINGS', eventDateTime: '2026-10-20', providerEventId: null });
  assert.equal(withoutId.identityKey, 'OPTIONOMICS:AAPL:EARNINGS:2026-10-20');
  assert.equal(withoutId.identityBasis, 'UNDERLYING_FAMILY_DATE_FALLBACK');
});

test('foldThetaFirstObservedAt keeps the earliest observation and never regresses on a later poll', () => {
  const result = foldThetaFirstObservedAt([
    { identityKey: 'e1', ingestedAt: '2026-10-02T00:00:00Z' },
    { identityKey: 'e1', ingestedAt: '2026-10-01T00:00:00Z' }, // earlier poll observed later in the array
    { identityKey: 'e1', ingestedAt: '2026-10-05T00:00:00Z' },
    { identityKey: 'e2', ingestedAt: null },
  ]);
  assert.equal(result.get('e1'), '2026-10-01T00:00:00Z');
  assert.equal(result.get('e2'), null);
});

test('wasEventKnownToThetaAtDecision uses ONLY thetaFirstObservedAt, never eventTime or providerKnownAt', () => {
  assert.equal(wasEventKnownToThetaAtDecision('2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z'), 'KNOWN');
  assert.equal(wasEventKnownToThetaAtDecision('2026-09-10T00:00:00Z', '2026-09-05T00:00:00Z'), 'UNKNOWN');
  assert.equal(wasEventKnownToThetaAtDecision(null, '2026-09-05T00:00:00Z'), 'UNKNOWN');
  assert.equal(wasEventKnownToThetaAtDecision('not-a-date', '2026-09-05T00:00:00Z'), 'INVALID_TIMESTAMP');
  assert.equal(wasEventKnownToThetaAtDecision('2026-09-01T00:00:00Z', 'not-a-date'), 'INVALID_TIMESTAMP');
});

test('a persisted thetaFirstObservedAt classifies as the strongest PIT basis', () => {
  const result = classifyHistoricalEventPit(record({ thetaFirstObservedAt: '2026-10-01T00:05:00Z' }));
  assert.equal(result.classification, 'PIT_SAFE_THETA_FIRST_OBSERVED');
});

test('providerKnownAt before eventTime, with no thetaFirstObservedAt, is a weaker but defensible PIT basis', () => {
  const result = classifyHistoricalEventPit(record({ thetaFirstObservedAt: null }));
  assert.equal(result.classification, 'PIT_SAFE_PROVIDER_TIMESTAMP');
});

test('providerKnownAt AFTER eventTime is AMBIGUOUS, never silently trusted as a PIT signal', () => {
  const result = classifyHistoricalEventPit(record({
    thetaFirstObservedAt: null, providerKnownAt: '2026-10-25T00:00:00Z', eventTime: '2026-10-20T20:00:00Z',
  }));
  assert.equal(result.classification, 'AMBIGUOUS');
});

test('missing both thetaFirstObservedAt and a defensible providerKnownAt is HISTORICAL_NOT_PIT_SAFE, never repaired from eventTime', () => {
  const result = classifyHistoricalEventPit(record({ thetaFirstObservedAt: null, providerKnownAt: null }));
  assert.equal(result.classification, 'HISTORICAL_NOT_PIT_SAFE');
});

test('summarizeHistoricalEventPitStudy reports real counts and bounded examples per class, never a repair', () => {
  const summary = summarizeHistoricalEventPitStudy([
    record({ identityKey: 'e1', thetaFirstObservedAt: '2026-10-01T00:00:00Z' }),
    record({ identityKey: 'e2', thetaFirstObservedAt: null }),
    record({ identityKey: 'e3', thetaFirstObservedAt: null, providerKnownAt: null }),
    record({ identityKey: 'e4', thetaFirstObservedAt: null, providerKnownAt: '2026-10-25T00:00:00Z' }),
  ]);
  assert.equal(summary.totalRows, 4);
  assert.equal(summary.counts.PIT_SAFE_THETA_FIRST_OBSERVED, 1);
  assert.equal(summary.counts.PIT_SAFE_PROVIDER_TIMESTAMP, 1);
  assert.equal(summary.counts.HISTORICAL_NOT_PIT_SAFE, 1);
  assert.equal(summary.counts.AMBIGUOUS, 1);
  assert.deepEqual(summary.examples.PIT_SAFE_THETA_FIRST_OBSERVED, ['e1']);
});

test('fromCanonicalEventEvidence never fabricates providerPublishedAt or thetaFirstObservedAt from fields Codex does not carry', () => {
  const raw: RawEventEvidence = {
    source: 'OPTIONOMICS', providerEventId: 'evt-9', underlying: 'AAPL', eventType: 'EARNINGS',
    eventTime: '2026-10-20T20:00:00Z', knownAt: '2026-10-01T00:00:00Z', observedAt: '2026-10-01T00:05:00Z',
    payloadHash: 'hash', applicable: true,
  };
  const normalized = normalizeEventEvidence(raw, '2026-10-01T00:10:00Z');
  const mapped = fromCanonicalEventEvidence(normalized);
  assert.equal(mapped.providerKnownAt, '2026-10-01T00:00:00Z');
  assert.equal(mapped.ingestedAt, '2026-10-01T00:05:00Z');
  assert.equal(mapped.providerPublishedAt, null); // not carried by the canonical contract -- never guessed
  assert.equal(mapped.thetaFirstObservedAt, null); // requires cross-observation folding, not a single row
});
