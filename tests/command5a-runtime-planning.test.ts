import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommand5aCalendarRange,
  command5aCalendarLookaheadDays,
  command5aPageFailureDisposition,
  classifyCommand5aSchedulingStorage,
  command5aSafeFailureCode,
  lastSafeCommand5aPageIndex,
  processCommand5aPage,
  resolveCommand5aFeeds,
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

test('an explicit Command-5A feed cannot silently downgrade to a different feed', () => {
  assert.deepEqual(resolveCommand5aFeeds({}), { optionFeed: 'indicative', stockFeed: 'iex' });
  assert.deepEqual(resolveCommand5aFeeds({ optionFeed: 'opra', stockFeed: 'sip' }),
    { optionFeed: 'opra', stockFeed: 'sip' });
  assert.throws(() => resolveCommand5aFeeds({ optionFeed: 'opr' }), /COMMAND5A_OPTION_FEED_INVALID/);
  assert.throws(() => resolveCommand5aFeeds({ stockFeed: 'sipp' }), /COMMAND5A_STOCK_FEED_INVALID/);
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
  assert.equal(command5aSafeFailureCode(Object.assign(new Error('quota'), { code: '53000' })),
    'COMMAND5A_POSTGRES_RESOURCE_LIMIT');
  assert.equal(command5aSafeFailureCode(Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' })),
    'COMMAND5A_SQLITE_BUSY');
  assert.equal(command5aPageFailureDisposition('FRONTIER_ARCHIVE_INVALID'), 'TERMINAL_IMMUTABLE_SKIP');
  assert.equal(command5aPageFailureDisposition('COMMAND5A_UNCLASSIFIED_FAILURE'), 'RETRY_REQUIRED');
  assert.equal(command5aPageFailureDisposition('LOCAL_OBSERVATION_JOB_IDENTITY_CONFLICT'), 'RETRY_REQUIRED');
  assert.equal(lastSafeCommand5aPageIndex(outcomes), 1);
  assert.equal(lastSafeCommand5aPageIndex([
    { state: 'PROCESSED', value: 'FIRST' },
    { state: 'SKIPPED', reasonCode: 'COMMAND5A_UNCLASSIFIED_FAILURE' },
    { state: 'PROCESSED', value: 'THIRD' },
  ]), 0);
  assert.equal(lastSafeCommand5aPageIndex([
    { state: 'SKIPPED', reasonCode: 'COMMAND5A_UNCLASSIFIED_FAILURE' },
    { state: 'PROCESSED', value: 'SECOND' },
  ]), -1);
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

test('Command-5A preserves connection and SQL failures without exposing private detail',()=>{
  assert.equal(command5aSafeFailureCode(new Error('Connection terminated unexpectedly; private-detail')),
    'COMMAND5A_POSTGRES_CONNECTION_TERMINATED');
  assert.equal(command5aSafeFailureCode(Object.assign(new Error('private-detail'),{code:'42703'})),
    'COMMAND5A_POSTGRES_42703');
  assert.equal(command5aSafeFailureCode(new Error('private-detail')), 'COMMAND5A_UNCLASSIFIED_FAILURE');
  assert.equal(command5aPageFailureDisposition('COMMAND5A_POSTGRES_CONNECTION_TERMINATED'),'RETRY_REQUIRED');
});
