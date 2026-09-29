import assert from 'node:assert/strict';
import test from 'node:test';
import { alpacaCalendarToLearningSessions, newYorkSessionTime } from '../src/research/alpaca-learning-calendar.js';

test('New York session conversion preserves DST and standard-time exchange clocks', () => {
  assert.equal(newYorkSessionTime('2026-09-25', '09:30'), '2026-09-25T13:30:00.000Z');
  assert.equal(newYorkSessionTime('2026-11-20', '09:30'), '2026-11-20T14:30:00.000Z');
  assert.equal(newYorkSessionTime('2026-09-25', '16:00'), '2026-09-25T20:00:00.000Z');
});

test('incomplete Alpaca calendar rows stay excluded instead of gaining invented hours', () => {
  const sessions = alpacaCalendarToLearningSessions([
    { date: '2026-09-25', open: '09:30', close: '16:00', sessionOpen: null, sessionClose: null },
    { date: '2026-09-26', open: null, close: null, sessionOpen: null, sessionClose: null },
  ]);
  assert.deepEqual(sessions, [{ date: '2026-09-25', openAt: '2026-09-25T13:30:00.000Z',
    closeAt: '2026-09-25T20:00:00.000Z', source: 'ALPACA_CALENDAR' }]);
});
