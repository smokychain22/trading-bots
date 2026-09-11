import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLifecycleTransition,
  assertValidLifecycleTransition,
  InvalidLifecycleTransitionError,
  isValidLifecycleTransition,
} from '../src/theta/runtime-state.js';

test('the canonical happy path is valid start to finish', () => {
  const path: [string, string][] = [
    ['WAIT', 'CSP_PROPOSED'],
    ['CSP_PROPOSED', 'CSP_OPEN'],
    ['CSP_OPEN', 'EXPIRE_OTM'],
    ['EXPIRE_OTM', 'REDEPLOY'],
    ['REDEPLOY', 'WAIT'],
  ];
  for (const [from, to] of path) {
    assertValidLifecycleTransition(from as never, to as never);
  }
});

test('the assignment-to-recovery-to-covered-call path is valid', () => {
  const path: [string, string][] = [
    ['CSP_OPEN', 'ROLL_DECISION'],
    ['ROLL_DECISION', 'ASSIGNED'],
    ['ASSIGNED', 'STOCK_HELD'],
    ['STOCK_HELD', 'RECOVERY_WAIT'],
    ['RECOVERY_WAIT', 'CC_PROPOSED'],
    ['CC_PROPOSED', 'CC_OPEN'],
    ['CC_OPEN', 'CALL_AWAY'],
    ['CALL_AWAY', 'CLOSED'],
  ];
  for (const [from, to] of path) {
    assertValidLifecycleTransition(from as never, to as never);
  }
});

test('CSP and covered-call rolls use distinct proposal states', () => {
  assertValidLifecycleTransition('ROLL_DECISION', 'CSP_PROPOSED');
  assertValidLifecycleTransition('ROLL_DECISION', 'CC_PROPOSED');
  assertValidLifecycleTransition('CLOSE_CC', 'RECOVERY_WAIT');
});

test('an invalid transition is rejected, never silently coerced', () => {
  assert.equal(isValidLifecycleTransition('WAIT', 'CC_OPEN'), false);
  assert.throws(() => assertValidLifecycleTransition('WAIT', 'CC_OPEN'), InvalidLifecycleTransitionError);
});

test('CLOSED is terminal -- no transition leaves it', () => {
  assert.throws(() => assertValidLifecycleTransition('CLOSED', 'WAIT'));
});

test('applyLifecycleTransition records a validated transition', () => {
  const record = applyLifecycleTransition('chain-1', 'WAIT', 'CSP_PROPOSED', 'decision-1', new Date().toISOString());
  assert.equal(record.chainId, 'chain-1');
  assert.equal(record.from, 'WAIT');
  assert.equal(record.to, 'CSP_PROPOSED');
});

test('applyLifecycleTransition throws rather than recording an invalid transition', () => {
  assert.throws(() => applyLifecycleTransition('chain-1', 'WAIT', 'CLOSED', 'decision-1', new Date().toISOString()));
});
