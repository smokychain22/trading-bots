import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecoverySurvivalRow } from '../src/research/recovery-survival-dataset.js';

test('a resolved recovery episode is RESOLVED with real calendar days computed', () => {
  const row = buildRecoverySurvivalRow({
    recoveryEpisodeId: 'r1', assignmentAt: '2026-08-01T00:00:00Z', terminalDispositionAt: '2026-08-11T00:00:00Z',
    observationCutoffAt: '2026-09-25T00:00:00Z', tradingDays: 7, dailyCapital: [],
  });
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.calendarDays, 10);
  assert.equal(row.tradingDays, 7);
});

test('CORE CLAIM: an open recovery episode is RIGHT_CENSORED and retained, never discarded', () => {
  const row = buildRecoverySurvivalRow({
    recoveryEpisodeId: 'r2', assignmentAt: '2026-08-01T00:00:00Z', terminalDispositionAt: null,
    observationCutoffAt: '2026-09-25T00:00:00Z', tradingDays: null, dailyCapital: [],
  });
  assert.equal(row.status, 'RIGHT_CENSORED');
  assert.ok(row.calendarDays > 0);
});

test('calendar days, trading days, and capital days are three separate, never-conflated quantities', () => {
  const row = buildRecoverySurvivalRow({
    recoveryEpisodeId: 'r3', assignmentAt: '2026-08-01T00:00:00Z', terminalDispositionAt: '2026-08-11T00:00:00Z',
    observationCutoffAt: '2026-09-25T00:00:00Z', tradingDays: 7,
    dailyCapital: [{ date: '2026-08-01', capitalCommitted: 1000 }, { date: '2026-08-02', capitalCommitted: 1000 }],
  });
  assert.notEqual(row.calendarDays, row.tradingDays);
  assert.equal(row.capitalDays, 2000);
});

test('ADVERSARIAL: a terminal disposition before assignment is rejected', () => {
  assert.throws(() => buildRecoverySurvivalRow({
    recoveryEpisodeId: 'r4', assignmentAt: '2026-08-01T00:00:00Z', terminalDispositionAt: '2026-07-01T00:00:00Z',
    observationCutoffAt: '2026-09-25T00:00:00Z', tradingDays: null, dailyCapital: [],
  }), /RECOVERY_SURVIVAL_TERMINAL_BEFORE_ASSIGNMENT/);
});
