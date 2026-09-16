import assert from 'node:assert/strict';
import test from 'node:test';
import { optionomicsRawObservationTime } from '../src/theta/postgres-theta-cycle-store.js';

test('raw Optionomics as-of is retrieval time, never the later decision time', () => {
  assert.deepEqual(optionomicsRawObservationTime(
    '2026-09-16T15:24:40.000Z', '2026-09-16T15:24:39.000Z', 'GOOD',
  ), {
    asOf: '2026-09-16T15:24:40.000Z', providerTimestamp: '2026-09-16T15:24:39.000Z', quality: 'GOOD',
  });
});

test('future or malformed provider time is quarantined, never rewritten as valid evidence', () => {
  assert.deepEqual(optionomicsRawObservationTime(
    '2026-09-16T15:24:40.000Z', '2026-09-16T15:24:41.000Z', 'GOOD',
  ), { asOf: '2026-09-16T15:24:40.000Z', providerTimestamp: null, quality: 'INVALID' });
  assert.throws(() => optionomicsRawObservationTime('not-a-time', null, 'GOOD'), /RETRIEVAL_TIMESTAMP_INVALID/);
});
