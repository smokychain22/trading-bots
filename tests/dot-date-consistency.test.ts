import assert from 'node:assert/strict';
import test from 'node:test';
import { researchDteConsistent } from '../src/lab/date-consistency.js';

test('normalized research dates preserve leap years and explicit UTC calendar-day basis', () => {
  assert.equal(researchDteConsistent({ expiration: '2026-10-08', dte: 3 }, '2026-10-05T15:00:00Z'), true);
  assert.equal(researchDteConsistent({ expiration: '2026-10-07', dte: 3 }, '2026-10-05T15:00:00Z'), false);
  assert.equal(researchDteConsistent({ expiration: '2024-03-01', dte: 2 }, '2024-02-28T15:00:00Z'), true);
  assert.equal(researchDteConsistent({ expiration: '2026-10-09', dte: 1 }, '2026-10-09T00:30:00+05:00'), true);
  assert.equal(researchDteConsistent({ expiration: '2026-10-08', dte: 0 }, '2026-10-08T23:30:00Z'), true);
});

test('malformed, timestamp-valued, expired, fractional and impossible research dates fail explicitly', () => {
  for (const expiration of ['2026-02-30', '2026-10-08T20:00:00Z', '10/08/2026', '', '2026-10-07'])
    assert.equal(researchDteConsistent({ expiration, dte: 0 }, '2026-10-08T15:00:00Z'), false);
  for (const dte of [-1, 2.5, NaN, Infinity])
    assert.equal(researchDteConsistent({ expiration: '2026-10-08', dte }, '2026-10-08T15:00:00Z'), false);
  assert.equal(researchDteConsistent({ expiration: '2026-10-08', dte: 0 }, 'bad'), false);
});
