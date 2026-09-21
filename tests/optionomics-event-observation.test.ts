import assert from 'node:assert/strict';
import test from 'node:test';
import { optionomicsEventRevisions } from '../src/theta/optionomics-event-observation.js';

const retrievedAt = '2026-09-21T12:00:00.000Z';

test('event revisions retain provider-known and THETA first-observed clocks separately', () => {
  const event = { id: 'event-1', kind: 'macro', date: '2026-09-23',
    scheduled_at: '2026-09-23T18:00:00Z', known_at: '2026-09-20T10:00:00Z' };
  const first = optionomicsEventRevisions({ events: [event] }, retrievedAt)[0];
  const repeat = optionomicsEventRevisions({ events: [event] }, '2026-09-22T12:00:00Z')[0];
  const revised = optionomicsEventRevisions({ events: [{ ...event, scheduled_at: '2026-09-23T19:00:00Z' }] }, retrievedAt)[0];
  assert.equal(first?.pitTimingState, 'TIMING_VALID');
  assert.equal(first?.providerKnownAt, '2026-09-20T10:00:00.000Z');
  assert.equal(first?.firstObservedAt, retrievedAt);
  assert.equal(first?.payloadHash, repeat?.payloadHash);
  assert.notEqual(first?.payloadHash, revised?.payloadHash);
});

test('event without provider known time cannot become PIT-valid', () => {
  const [event] = optionomicsEventRevisions({ events: [{ id: 'event-2', kind: 'filing', date: '2026-09-22' }] }, retrievedAt);
  assert.equal(event?.pitTimingState, 'KNOWN_AT_UNKNOWN');
  assert.equal(event?.providerKnownAt, null);
});

test('future-known timestamp and malformed event identity remain fail-closed', () => {
  const [event] = optionomicsEventRevisions({ events: [
    { id: 'event-3', known_at: '2026-09-22T12:00:00Z' },
    { known_at: '2026-09-20T12:00:00Z' },
  ] }, retrievedAt);
  assert.equal(event?.pitTimingState, 'KNOWN_AFTER_OBSERVATION');
  assert.equal(optionomicsEventRevisions({ events: [{ date: '2026-09-22' }] }, retrievedAt).length, 0);
});
