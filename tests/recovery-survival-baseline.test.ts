import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKaplanMeierSurvivalCurve } from '../src/research/recovery-survival-baseline.js';
import { buildRecoverySurvivalRow } from '../src/research/recovery-survival-dataset.js';

function resolvedRow(id: string, calendarDays: number) {
  return buildRecoverySurvivalRow({
    recoveryEpisodeId: id, assignmentAt: '2026-01-01T00:00:00Z',
    terminalDispositionAt: new Date(Date.parse('2026-01-01T00:00:00Z') + calendarDays * 86_400_000).toISOString(),
    observationCutoffAt: '2026-09-26T00:00:00Z', tradingDays: null, dailyCapital: [],
  });
}

function censoredRow(id: string, calendarDaysSoFar: number) {
  return buildRecoverySurvivalRow({
    recoveryEpisodeId: id, assignmentAt: '2026-01-01T00:00:00Z', terminalDispositionAt: null,
    observationCutoffAt: new Date(Date.parse('2026-01-01T00:00:00Z') + calendarDaysSoFar * 86_400_000).toISOString(),
    tradingDays: null, dailyCapital: [],
  });
}

test('zero rows yields an empty, honest curve', () => {
  const curve = buildKaplanMeierSurvivalCurve([]);
  assert.equal(curve.independentN, 0);
  assert.equal(curve.curve.length, 0);
  assert.equal(curve.medianSurvivalDays, null);
});

test('CORE CLAIM: a censored episode contributes to at-risk counts but never counts as an event', () => {
  const rows = [resolvedRow('a', 10), censoredRow('b', 20)];
  const curve = buildKaplanMeierSurvivalCurve(rows);
  assert.equal(curve.eventCount, 1);
  assert.equal(curve.censoredCount, 1);
  const eventPoint = curve.curve.find((p) => p.calendarDays === 10);
  assert.equal(eventPoint?.events, 1);
});

test('survival probability strictly decreases across real event times', () => {
  const rows = [resolvedRow('a', 5), resolvedRow('b', 10), resolvedRow('c', 15)];
  const curve = buildKaplanMeierSurvivalCurve(rows);
  const probabilities = curve.curve.map((p) => p.survivalProbability);
  for (let i = 1; i < probabilities.length; i += 1) assert.ok((probabilities[i] as number) <= (probabilities[i - 1] as number));
});

test('all-censored sample produces zero events and a null median (never fabricated)', () => {
  const rows = [censoredRow('a', 10), censoredRow('b', 20)];
  const curve = buildKaplanMeierSurvivalCurve(rows);
  assert.equal(curve.eventCount, 0);
  assert.equal(curve.medianSurvivalDays, null);
});
