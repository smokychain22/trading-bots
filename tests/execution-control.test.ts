import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeBrokerMutation,
  evaluateExecutionGate,
  type ExecutionGateContext,
} from '../src/execution/execution-control.js';

// Synthetic gate-only inputs. These tests cannot call a broker.
const control = { masterEnabled: true, followerEnabled: false, pauseNewOrders: false };
const context: ExecutionGateContext = {
  accountKind: 'MASTER_API_KEY', environment: 'PAPER',
  baseHostname: 'paper-api.alpaca.markets', accountVerified: true,
  optionsCapabilityVerified: true, intentPersisted: true,
  aegisState: 'ALLOW_FULL', quantity: 1, quoteFresh: true,
  decisionExpiresAt: '2026-09-11T14:01:00.000Z',
  now: '2026-09-11T14:00:00.000Z', clientOrderId: 'test-time-gate', isNewEntry: true,
};

for (const field of ['decisionExpiresAt', 'now'] as const) {
  for (const value of ['', 'not-a-date', '2026-99-99T99:99:99Z']) {
    test(`rejects invalid ${field}: ${JSON.stringify(value)}`, () => {
      const input = { ...context, [field]: value };
      const result = evaluateExecutionGate(control, input);
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.includes('DECISION_TIME_INVALID'));
      assert.throws(() => authorizeBrokerMutation(control, input), /DECISION_TIME_INVALID/);
    });
  }
}

test('expiry boundary and past decisions remain blocked', () => {
  for (const now of [context.decisionExpiresAt, '2026-09-11T14:02:00.000Z']) {
    assert.deepEqual(evaluateExecutionGate(control, { ...context, now }), {
      allowed: false, blockers: ['DECISION_EXPIRED'],
    });
  }
});

test('valid unexpired decision passes only when other gates pass', () => {
  assert.equal(evaluateExecutionGate(control, context).allowed, true);
  assert.equal(evaluateExecutionGate({ ...control, masterEnabled: false }, context).allowed, false);
  assert.equal(evaluateExecutionGate(control, { ...context, quantity: 0 }).allowed, false);
  assert.equal(evaluateExecutionGate(control, { ...context, baseHostname: 'api.alpaca.markets' }).allowed, false);
});
