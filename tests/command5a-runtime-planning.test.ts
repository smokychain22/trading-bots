import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommand5aCalendarRange,
  command5aCalendarLookaheadDays,
  command5aSafeFailureCode,
  processCommand5aPage,
} from '../src/research/command5a-runtime-planning.js';

test('short-DTE subjects still request enough calendar coverage for later learning horizons', () => {
  const range = buildCommand5aCalendarRange([{
    decisionAt: '2026-09-25T19:00:00.000Z',
    expirations: ['2026-09-28'],
  }]);
  assert.deepEqual(range, {
    start: '2026-09-25',
    end: '2026-10-16',
    lookaheadDays: command5aCalendarLookaheadDays,
  });
});

test('a later expiration extends the calendar query without changing the decision start', () => {
  assert.deepEqual(buildCommand5aCalendarRange([{
    decisionAt: '2026-09-25T19:00:00.000Z', expirations: ['2026-11-20'],
  }]), { start: '2026-09-25', end: '2026-11-20', lookaheadDays: 21 });
  assert.equal(buildCommand5aCalendarRange([{ decisionAt: 'invalid', expirations: [] }]), null);
});

test('one invalid frontier does not starve later immutable frontiers in the same page', () => {
  const outcomes = processCommand5aPage(['bad', 'good'], (value) => {
    if (value === 'bad') throw new Error('FRONTIER_ARCHIVE_INVALID:bounded-detail');
    return value.toUpperCase();
  });
  assert.deepEqual(outcomes, [
    { state: 'SKIPPED', reasonCode: 'FRONTIER_ARCHIVE_INVALID' },
    { state: 'PROCESSED', value: 'GOOD' },
  ]);
  assert.equal(command5aSafeFailureCode(new Error('unsafe detail')), 'COMMAND5A_UNCLASSIFIED_FAILURE');
});
