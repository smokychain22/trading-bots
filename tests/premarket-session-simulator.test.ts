import assert from 'node:assert/strict';
import test from 'node:test';
import { runSessionSimulation, sessionSimulationCases } from '../src/operations/premarket-session-simulator.js';

test('closed-market session simulator covers every required session class without broker authority', () => {
  const expected = ['PREMARKET', 'OPEN', 'FIRST_5_MINUTES', 'POST_OPEN', 'MIDDAY', 'LATE_SESSION',
    'LAST_30_MINUTES', 'EXPIRATION_WINDOW', 'CLOSE', 'POST_CLOSE', 'EARLY_CLOSE', 'HOLIDAY', 'WEEKEND', 'DST_TRANSITION'];
  assert.deepEqual(sessionSimulationCases.map((scenario) => scenario.caseId), expected);
  assert.deepEqual(runSessionSimulation(), { total: expected.length, pass: expected.length, failures: [] });
});
