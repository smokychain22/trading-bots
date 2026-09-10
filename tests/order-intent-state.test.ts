import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOrderIntentTransition,
  assertValidOrderIntentTransition,
  generateClientOrderId,
  InvalidOrderIntentTransitionError,
  isValidOrderIntentTransition,
} from '../src/theta/order-intent-state.js';

test('the happy path from proposal to fill is valid', () => {
  const path: [string, string][] = [
    ['PROPOSED', 'PREFLIGHT'],
    ['PREFLIGHT', 'READY'],
    ['READY', 'SUBMITTING'],
    ['SUBMITTING', 'SUBMITTED'],
    ['SUBMITTED', 'ACKNOWLEDGED'],
    ['ACKNOWLEDGED', 'FILLED'],
  ];
  for (const [from, to] of path) {
    assertValidOrderIntentTransition(from as never, to as never);
  }
});

test('UNKNOWN_SUBMISSION can only reconcile, never resubmit directly', () => {
  assert.equal(isValidOrderIntentTransition('UNKNOWN_SUBMISSION', 'RECONCILING'), true);
  assert.equal(isValidOrderIntentTransition('UNKNOWN_SUBMISSION', 'SUBMITTING'), false);
  assert.throws(
    () => assertValidOrderIntentTransition('UNKNOWN_SUBMISSION', 'SUBMITTING'),
    InvalidOrderIntentTransitionError,
  );
});

test('reconciliation can resolve to any broker-proven truth, including a fresh proposal', () => {
  for (const to of ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'PROPOSED']) {
    assert.equal(isValidOrderIntentTransition('RECONCILING', to as never), true);
  }
});

test('terminal states have no outgoing transitions', () => {
  for (const terminal of ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']) {
    assert.throws(() => assertValidOrderIntentTransition(terminal as never, 'SUBMITTING' as never));
  }
});

test('broker truth may jump directly from submitted to partial or filled', () => {
  assert.equal(isValidOrderIntentTransition('SUBMITTED', 'PARTIAL'), true);
  assert.equal(isValidOrderIntentTransition('SUBMITTED', 'FILLED'), true);
  assert.equal(isValidOrderIntentTransition('SUBMITTING', 'FILLED'), true);
  assert.equal(isValidOrderIntentTransition('ACKNOWLEDGED', 'CANCELED'), true);
  assert.equal(isValidOrderIntentTransition('PARTIAL', 'CANCELED'), true);
});

test('applyOrderIntentTransition rejects an invalid transition rather than recording it', () => {
  assert.throws(() => applyOrderIntentTransition('intent-1', 'UNKNOWN_SUBMISSION', 'SUBMITTING', new Date().toISOString()));
});

test('client_order_id is deterministic -- identical inputs always produce the identical id', () => {
  const first = generateClientOrderId('decision-1', 'candidate-A', 1);
  const second = generateClientOrderId('decision-1', 'candidate-A', 1);
  assert.equal(first, second);
});

test('client_order_id differs across decisions, candidates, and attempts', () => {
  const base = generateClientOrderId('decision-1', 'candidate-A', 1);
  assert.notEqual(base, generateClientOrderId('decision-2', 'candidate-A', 1));
  assert.notEqual(base, generateClientOrderId('decision-1', 'candidate-B', 1));
  assert.notEqual(base, generateClientOrderId('decision-1', 'candidate-A', 2));
});

test('client_order_id requires an explicit positive integer attempt -- no implicit unlimited retry', () => {
  assert.throws(() => generateClientOrderId('decision-1', 'candidate-A', 0));
  assert.throws(() => generateClientOrderId('decision-1', 'candidate-A', 1.5));
});
