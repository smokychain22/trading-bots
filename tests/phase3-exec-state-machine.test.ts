// Phase 3 -- EXECUTION STATE MACHINE AUDIT.
//
// The owner's lifecycle vocabulary maps onto the real states as:
//   INTENT          -> PROPOSED, PREFLIGHT, READY          (persisted before any broker contact)
//   SUBMITTING      -> SUBMITTING                          (persisted BEFORE the POST; a crash here is recovered, never replayed)
//   ACKNOWLEDGED    -> SUBMITTED, ACKNOWLEDGED
//   WORKING         -> SUBMITTED, ACKNOWLEDGED, PARTIAL    (a live resting order)
//   PARTIAL         -> PARTIAL
//   FILLED          -> FILLED
//   CANCEL_REQUESTED-> CANCEL_REQUESTED
//   CANCELED        -> CANCELED
//   REPLACE         -> a coordinator OPERATION, not a state: the replacement is a NEW intent, the original ends CANCELED
//   REJECTED        -> REJECTED
//   EXPIRED         -> EXPIRED
//   UNKNOWN_RESULT  -> UNKNOWN_SUBMISSION
//   RECONCILED      -> RECONCILING resolving to the state the broker proves (there is no separate persisted RECONCILED state)
import assert from 'node:assert/strict';
import test from 'node:test';
import { brokerOrderIntentState } from '../src/execution/broker-order-state.js';
import type { BrokerOrderSnapshot } from '../src/execution/broker.js';
import { InMemoryPaperOrderStore } from '../src/execution/paper-order-coordinator.js';
import { ORDER_INTENT_TRANSITIONS, isValidOrderIntentTransition, type OrderIntentState } from '../src/theta/order-intent-state.js';
import { makeRig, optionGate, optionIntent, replacementOf, stockGate, stockIntent } from './phase3-exec-fixtures.js';

const ALL: readonly OrderIntentState[] = ['PROPOSED', 'PREFLIGHT', 'READY', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'FILLED',
  'CANCEL_REQUESTED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN_SUBMISSION', 'RECONCILING'];
const TERMINAL: readonly OrderIntentState[] = ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'];

// An independently written literal of the legal edges. It is the reviewed specification; the code must equal it exactly.
const LEGAL: Readonly<Record<OrderIntentState, readonly OrderIntentState[]>> = {
  PROPOSED: ['PREFLIGHT'],
  PREFLIGHT: ['READY', 'REJECTED'],
  READY: ['SUBMITTING', 'EXPIRED'],
  SUBMITTING: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED', 'UNKNOWN_SUBMISSION', 'REJECTED'],
  SUBMITTED: ['ACKNOWLEDGED', 'PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED', 'REJECTED', 'UNKNOWN_SUBMISSION'],
  ACKNOWLEDGED: ['PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED', 'REJECTED'],
  PARTIAL: ['FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'EXPIRED'],
  CANCEL_REQUESTED: ['CANCELED', 'FILLED', 'PARTIAL', 'UNKNOWN_SUBMISSION'],
  FILLED: [], CANCELED: [], REJECTED: [], EXPIRED: [],
  UNKNOWN_SUBMISSION: ['RECONCILING'],
  // PROPOSED is a documented design edge (a NEW attempt once an intent is proven never to have reached the broker). No production code
  // path takes it: the coordinator resolves an absent order to EXPIRED. A new attempt would need a new client order id (attempt+1).
  RECONCILING: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'REJECTED', 'EXPIRED', 'PROPOSED'],
};

test('the legal-transition table equals the reviewed specification exactly (no missing and no impossible edge)', () => {
  for (const from of ALL) {
    assert.deepEqual([...ORDER_INTENT_TRANSITIONS[from]].sort(), [...LEGAL[from]].sort(), `edges out of ${from}`);
  }
});

test('exhaustive: every ordered pair of states is accepted iff it is in the specification; terminal states have no way out', () => {
  for (const from of ALL) for (const to of ALL) {
    assert.equal(isValidOrderIntentTransition(from, to), LEGAL[from].includes(to), `${from} -> ${to}`);
  }
  for (const state of TERMINAL) assert.deepEqual(ORDER_INTENT_TRANSITIONS[state], [], `${state} is final`);
});

test('structural invariants: no blind resubmit, no resurrection, every state reaches a terminal state, every non-start state is reachable', () => {
  // UNKNOWN_SUBMISSION can only reconcile; nothing leads back to SUBMITTING except READY (the only pre-broker state)
  assert.deepEqual([...ORDER_INTENT_TRANSITIONS.UNKNOWN_SUBMISSION], ['RECONCILING']);
  for (const from of ALL) if (from !== 'READY') assert.ok(!ORDER_INTENT_TRANSITIONS[from].includes('SUBMITTING'), `${from} must not lead to SUBMITTING`);
  // the only way to a second POST for an intent is back through PROPOSED -> PREFLIGHT -> READY -> SUBMITTING, and no code takes that edge
  for (const from of ALL) {
    const seen = new Set<OrderIntentState>([from]); const queue: OrderIntentState[] = [from];
    while (queue.length > 0) for (const next of ORDER_INTENT_TRANSITIONS[queue.shift() as OrderIntentState]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    assert.ok(TERMINAL.some((terminal) => seen.has(terminal)), `${from} must be able to reach a terminal state`);
  }
  const reachable = new Set<OrderIntentState>(['PROPOSED']); const queue: OrderIntentState[] = ['PROPOSED'];
  while (queue.length > 0) for (const next of ORDER_INTENT_TRANSITIONS[queue.shift() as OrderIntentState]) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  assert.deepEqual([...ALL].filter((state) => !reachable.has(state)), [], 'every state is reachable from PROPOSED');
});

test('the in-memory store enforces the same table for every pair (stale and illegal transitions are refused)', async () => {
  for (const from of ALL) for (const to of ALL) {
    const store = new InMemoryPaperOrderStore();
    const base = optionIntent();
    await store.insertIntent({ ...base, status: from, brokerOrderId: null });
    const attempt = store.transitionIntent(base.orderIntentId, from, to);
    if (LEGAL[from].includes(to)) await attempt; else await assert.rejects(attempt, `${from} -> ${to}`);
  }
  // stale: the persisted state no longer matches the caller's belief
  const store = new InMemoryPaperOrderStore(); const base = optionIntent();
  await store.insertIntent({ ...base, status: 'SUBMITTED', brokerOrderId: null });
  await assert.rejects(store.transitionIntent(base.orderIntentId, 'READY', 'SUBMITTING'), /Stale or missing/);
});

const snapshot = (status: string, filled: number, qty = 3): BrokerOrderSnapshot => ({ id: 'o1', clientOrderId: 'c1', symbol: 'AAPL261016P00150000', status, qty, filledQty: filled,
  side: 'sell', positionIntent: 'sell_to_open', limitPrice: 1.25 } as unknown as BrokerOrderSnapshot);

test('every Alpaca order status maps to exactly one intent state; unknown statuses map to null (never a guess)', () => {
  const table: ReadonlyArray<readonly [string, OrderIntentState]> = [
    ['pending_new', 'SUBMITTED'], ['accepted_for_bidding', 'SUBMITTED'], ['pending_replace', 'SUBMITTED'],
    ['new', 'ACKNOWLEDGED'], ['accepted', 'ACKNOWLEDGED'], ['partially_filled', 'PARTIAL'], ['filled', 'FILLED'], ['fill', 'FILLED'],
    ['pending_cancel', 'CANCEL_REQUESTED'], ['canceled', 'CANCELED'], ['replaced', 'CANCELED'], ['expired', 'EXPIRED'],
    ['done_for_day', 'EXPIRED'], ['calculated', 'EXPIRED'], ['rejected', 'REJECTED'], ['stopped', 'REJECTED'], ['suspended', 'REJECTED'],
  ];
  for (const [status, state] of table) assert.equal(brokerOrderIntentState(snapshot(status, 0)), state, status);
  assert.equal(brokerOrderIntentState(snapshot('some_new_status', 0)), null);
  // fills dominate: fully filled is FILLED whatever the status string says; part filled stays PARTIAL while working and is
  // CANCELED (terminal) once the order is done, keeping the filled quantity visible to the sweep and the freeze
  assert.equal(brokerOrderIntentState(snapshot('accepted', 3)), 'FILLED');
  assert.equal(brokerOrderIntentState(snapshot('accepted', 1)), 'PARTIAL');
  for (const done of ['canceled', 'expired', 'rejected', 'replaced', 'done_for_day', 'calculated']) {
    assert.equal(brokerOrderIntentState(snapshot(done, 1)), 'CANCELED', `part-filled ${done}`);
  }
});

test('restart recovery per non-terminal state: broker truth resolves the intent and nothing is re-POSTed', async () => {
  // READY (never reached the broker) stays READY and is expired by the stale-READY sweep, never submitted by recovery
  const rig = makeRig();
  const ready = await rig.coordinator.prepare(optionIntent());
  assert.deepEqual(await rig.coordinator.recoverAfterRestart('2026-10-02T14:05:00.000Z'), []);
  assert.equal((await rig.store.getIntent(ready.orderIntentId))?.status, 'READY');
  assert.equal(rig.server.mutationCount(), 0);

  // SUBMITTED / ACKNOWLEDGED / PARTIAL / CANCEL_REQUESTED sync from broker truth through reconcileIntent
  for (const [brokerStatus, filled, expected] of [['new', 0, 'ACKNOWLEDGED'], ['partially_filled', 1, 'PARTIAL'], ['filled', 3, 'FILLED'],
    ['canceled', 0, 'CANCELED'], ['expired', 0, 'EXPIRED'], ['pending_cancel', 0, 'CANCEL_REQUESTED']] as const) {
    const fresh = makeRig();
    const intent = await fresh.coordinator.prepare(optionIntent());
    await fresh.coordinator.submit(intent.orderIntentId, optionGate);
    fresh.server.patch(intent.request.client_order_id, { status: brokerStatus, filled_qty: String(filled) });
    await fresh.coordinator.reconcileIntent(intent.orderIntentId);
    assert.equal((await fresh.store.getIntent(intent.orderIntentId))?.status, expected, brokerStatus);
    assert.equal(fresh.server.count('POST /v2/orders'), 1, 'recovery never submits again');
  }
});

test('CANCEL_REQUESTED resolves to a terminal state even when the broker ends the order as expired or rejected', async () => {
  for (const ended of ['canceled', 'expired', 'rejected']) {
    const rig = makeRig();
    rig.server.cancelPending = true;
    const intent = await rig.coordinator.prepare(optionIntent());
    await rig.coordinator.submit(intent.orderIntentId, optionGate);
    await rig.coordinator.cancel(intent.orderIntentId, optionGate);
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'CANCEL_REQUESTED');
    rig.server.patch(intent.request.client_order_id, { status: ended });
    await rig.coordinator.reconcileIntent(intent.orderIntentId);
    assert.ok(TERMINAL.includes((await rig.store.getIntent(intent.orderIntentId))?.status as OrderIntentState), `after ${ended}`);
  }
});

test('REPLACE is an operation on a working order: a new intent carries the lineage and the original ends CANCELED', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(stockIntent({ decisionId: original.decisionId }), { limit: '189.9', attempt: 2 });
  await rig.coordinator.replace(original.orderIntentId, { ...replacement, request: { ...replacement.request, qty: original.request.qty },
    chainId: original.chainId, underlyingId: original.underlyingId }, stockGate);
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'CANCELED');
  const replaced = await rig.store.getIntent(replacement.orderIntentId);
  assert.equal(replaced?.status, 'ACKNOWLEDGED');
  assert.equal(replaced?.decisionId, original.decisionId, 'same decision lineage');
  assert.notEqual(replaced?.request.client_order_id, original.request.client_order_id, 'a new deterministic client order id per attempt');
  assert.equal(rig.server.count('PATCH /v2/orders/{id}'), 1);
});

test('Paper reachability: the states a Paper order can legally pass through are exactly those reachable from READY', () => {
  const fromReady = new Set<OrderIntentState>(['READY']); const queue: OrderIntentState[] = ['READY'];
  while (queue.length > 0) for (const next of ORDER_INTENT_TRANSITIONS[queue.shift() as OrderIntentState]) if (!fromReady.has(next)) { fromReady.add(next); queue.push(next); }
  // PROPOSED and PREFLIGHT are reachable only through the documented, unused RECONCILING -> PROPOSED edge.
  assert.deepEqual([...fromReady].sort(), ['ACKNOWLEDGED', 'CANCELED', 'CANCEL_REQUESTED', 'EXPIRED', 'FILLED', 'PARTIAL', 'PREFLIGHT', 'PROPOSED',
    'READY', 'RECONCILING', 'REJECTED', 'SUBMITTED', 'SUBMITTING', 'UNKNOWN_SUBMISSION']);
});
