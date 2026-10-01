import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidOrderIntentTransition, ORDER_INTENT_TRANSITIONS, type OrderIntentState } from '../src/theta/order-intent-state.js';

const states = Object.keys(ORDER_INTENT_TRANSITIONS) as OrderIntentState[];

test('CANCEL_REQUESTED resolves only to broker truth: canceled, a racing fill, a racing partial, or an ambiguous result', () => {
  assert.deepEqual([...ORDER_INTENT_TRANSITIONS.CANCEL_REQUESTED].sort(), ['CANCELED', 'FILLED', 'PARTIAL', 'UNKNOWN_SUBMISSION']);
  for (const forbidden of ['READY', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED', 'PROPOSED', 'EXPIRED'] as OrderIntentState[]) {
    assert.equal(isValidOrderIntentTransition('CANCEL_REQUESTED', forbidden), false, `CANCEL_REQUESTED -> ${forbidden}`);
  }
});

test('a broker submission can start only from READY: no state, including reconciliation, can re-enter SUBMITTING', () => {
  const entrants = states.filter((from) => isValidOrderIntentTransition(from, 'SUBMITTING'));
  assert.deepEqual(entrants, ['READY']);
});

test('terminal states never leave, and an ambiguous submission can only reconcile', () => {
  for (const terminal of ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'] as OrderIntentState[]) {
    assert.deepEqual(ORDER_INTENT_TRANSITIONS[terminal], [], `${terminal} must be terminal`);
  }
  assert.deepEqual(ORDER_INTENT_TRANSITIONS.UNKNOWN_SUBMISSION, ['RECONCILING']);
});

test('every state is reachable from PROPOSED and the machine has no dead non-terminal state', () => {
  const seen = new Set<OrderIntentState>(['PROPOSED']);
  const queue: OrderIntentState[] = ['PROPOSED'];
  while (queue.length > 0) {
    const current = queue.shift() as OrderIntentState;
    for (const next of ORDER_INTENT_TRANSITIONS[current]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  assert.deepEqual([...seen].sort(), [...states].sort());
  const terminal = new Set<OrderIntentState>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
  for (const state of states) if (!terminal.has(state)) assert.ok(ORDER_INTENT_TRANSITIONS[state].length > 0, `${state} is a dead end`);
});
