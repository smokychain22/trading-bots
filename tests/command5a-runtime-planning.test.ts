import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommand5aCalendarRange,
  command5aCalendarLookaheadDays,
  classifyCommand5aSchedulingStorage,
  command5aSafeFailureCode,
  processCommand5aPage,
} from '../src/research/command5a-runtime-planning.js';
import { localResearchSpoolBudgetBytes } from '../src/storage/local-research-archive-health.js';

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

test('immutable Parquet inventory stays visible without permanently pausing active scheduling', () => {
  const state = classifyCommand5aSchedulingStorage({
    schedulerBytes: 1024,
    spoolBytes: 2048,
    parquetBytes: localResearchSpoolBudgetBytes * 10,
  });
  assert.equal(state.activeSpoolBytes, 3072);
  assert.equal(state.totalLocalResearchBytes, 3072 + localResearchSpoolBudgetBytes * 10);
  assert.equal(state.spoolWatermark, 'NORMAL');
  assert.equal(classifyCommand5aSchedulingStorage({
    schedulerBytes: localResearchSpoolBudgetBytes,
    spoolBytes: 0,
    parquetBytes: 0,
  }).spoolWatermark, 'CRITICAL');
  assert.throws(() => classifyCommand5aSchedulingStorage({
    schedulerBytes: -1, spoolBytes: 0, parquetBytes: 0,
  }), /COMMAND5A_STORAGE_BYTES_INVALID/);
});
