import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStrategyLearningObservationSchedule, strategyLearningHorizonPolicyVersion,
  type StrategyLearningSession,
} from '../src/research/strategy-learning-horizon.js';

const sessions: readonly StrategyLearningSession[] = [
  { date: '2026-11-27', openAt: '2026-11-27T14:30:00Z', closeAt: '2026-11-27T18:00:00Z', source: 'ALPACA_CALENDAR' },
  { date: '2026-11-30', openAt: '2026-11-30T14:30:00Z', closeAt: '2026-11-30T21:00:00Z', source: 'ALPACA_CALENDAR' },
  { date: '2026-12-01', openAt: '2026-12-01T14:30:00Z', closeAt: '2026-12-01T21:00:00Z', source: 'ALPACA_CALENDAR' },
  { date: '2026-12-02', openAt: '2026-12-02T14:30:00Z', closeAt: '2026-12-02T21:00:00Z', source: 'ALPACA_CALENDAR' },
  { date: '2026-12-03', openAt: '2026-12-03T14:30:00Z', closeAt: '2026-12-03T21:00:00Z', source: 'ALPACA_CALENDAR' },
  { date: '2026-12-04', openAt: '2026-12-04T14:30:00Z', closeAt: '2026-12-04T21:00:00Z', source: 'ALPACA_CALENDAR' },
];

const input = {
  subjectId: 'a'.repeat(64), decisionAt: '2026-11-27T16:00:00Z', decisionSessionDate: '2026-11-27',
  expirationDate: '2026-12-04', sessions,
  policy: { version: strategyLearningHorizonPolicyVersion, primaryCommonHorizon: '3_TRADING_DAYS' as const,
    tradingDayTarget: 'SESSION_CLOSE' as const },
};

test('Friday trading-day horizons use actual sessions, including early close, never weekend dates', () => {
  const result = buildStrategyLearningObservationSchedule(input);
  const byCode = new Map(result.map((job) => [job.horizonCode, job]));
  assert.equal(byCode.get('EOD')?.targetAt, '2026-11-27T18:00:00.000Z');
  assert.equal(byCode.get('1_TRADING_DAY')?.targetSessionDate, '2026-11-30');
  assert.equal(byCode.get('3_TRADING_DAYS')?.targetSessionDate, '2026-12-02');
  assert.equal(byCode.get('5_TRADING_DAYS')?.targetSessionDate, '2026-12-04');
  assert.equal(byCode.get('EXPIRATION')?.targetAt, '2026-12-04T21:00:00.000Z');
});

test('primary common horizon is caller-governed and duplicates the exact selected target', () => {
  const result = buildStrategyLearningObservationSchedule(input);
  const primary = result.find((job) => job.horizonCode === 'PRIMARY_COMMON_HORIZON');
  const threeDay = result.find((job) => job.horizonCode === '3_TRADING_DAYS');
  assert.equal(primary?.derivedFromHorizonCode, '3_TRADING_DAYS');
  assert.equal(primary?.targetAt, threeDay?.targetAt);
  assert.equal(primary?.targetSessionDate, threeDay?.targetSessionDate);
  assert.notEqual(primary?.observationJobId, threeDay?.observationJobId);
});

test('incomplete calendar stays explicitly unscheduled instead of inventing a date', () => {
  const result = buildStrategyLearningObservationSchedule({ ...input, sessions: sessions.slice(0, 2) });
  assert.equal(result.find((job) => job.horizonCode === '3_TRADING_DAYS')?.targetState,
    'UNSCHEDULED_CALENDAR_INCOMPLETE');
  assert.equal(result.find((job) => job.horizonCode === 'EXPIRATION')?.targetState,
    'UNSCHEDULED_EXPIRATION_SESSION_MISSING');
  assert.equal(result.find((job) => job.horizonCode === 'PRIMARY_COMMON_HORIZON')?.targetAt, null);
});

test('same logical schedule is restart deterministic and has no broker authority', () => {
  const first = buildStrategyLearningObservationSchedule(input);
  const second = buildStrategyLearningObservationSchedule(input);
  assert.deepEqual(first, second);
  assert.equal(first.length, 8);
  assert.ok(first.every((job) => job.brokerAuthority === false));
});
