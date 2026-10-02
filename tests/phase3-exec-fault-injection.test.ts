// Phase 3 -- BROKER FAULT-INJECTION CAMPAIGN (offline, stateful fake Alpaca PAPER server, no network).
//
// MATRIX (operation x fault -> required outcome). "applied" = the server performed the mutation before the client saw the fault.
//
//  READS (getOrderByClientOrderId / getOrders / getPositions): never mutate; bounded retry only for transient classes.
//    timeout / ECONNRESET / DNS ....... AMBIGUOUS_NETWORK, retried (bounded), recovers if the fault clears
//    429 + short Retry-After .......... RATE_LIMITED, retried honoring Retry-After, total wait capped
//    429 + long Retry-After ........... RATE_LIMITED, NOT retried (never sleeps unboundedly)
//    500 .............................. AMBIGUOUS_NETWORK, not retried;  502/503/504 retried
//    401 -> INVALID_AUTH, 403 -> NOT_ENTITLED, 422 -> BROKER_REJECTED, 404 -> null (by client id) / BROKER_REJECTED, never retried
//    malformed JSON / truncated / empty / wrong content type ... MALFORMED_RESPONSE, never retried, never "empty data"
//  SUBMIT:   ambiguous faults -> UNKNOWN_SUBMISSION + reconcile by client id (see phase3-exec-unknown-submit);
//            429 / 4xx -> reconciled by client id before REJECTED; duplicate client id -> the existing order is adopted, no second order
//  CANCEL:   ambiguous -> UNKNOWN_SUBMISSION + reconcile; 429 -> error, intent stays CANCEL_REQUESTED, cancel may be re-issued;
//            404/422 because the order already ended -> broker truth is read and wins
//  REPLACE:  applied+lost response -> replacement adopted, original closed; not applied -> replacement unresolved, original untouched;
//            422 because the original ended -> original synced from broker truth; 429 -> replacement REJECTED, original untouched
import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerError } from '../src/execution/broker.js';
import { FakeAlpaca, makeRig, optionGate, optionIntent, replacementOf, stockGate, stockIntent, type FaultResponse } from './phase3-exec-fixtures.js';

const LOOKUP = 'GET /v2/orders:by_client_order_id';
const LIST = 'GET /v2/orders';
const POSITIONS = 'GET /v2/positions';
const POST = 'POST /v2/orders';
const DELETE = 'DELETE /v2/orders/{id}';
const PATCH = 'PATCH /v2/orders/{id}';

async function caught(promise: Promise<unknown>): Promise<AlpacaPaperBrokerError | null> {
  try { await promise; return null; } catch (error) { if (error instanceof AlpacaPaperBrokerError) return error; throw error; }
}

// ---------------------------------------------------------------------------------------------------------------- READS
type ReadCase = readonly [name: string, fault: FaultResponse, category: string | 'NULL', retried: boolean];
const readCases: readonly ReadCase[] = [
  ['timeout', { kind: 'timeout' }, 'AMBIGUOUS_NETWORK', true],
  ['ECONNRESET', { kind: 'network', code: 'ECONNRESET' }, 'AMBIGUOUS_NETWORK', true],
  ['DNS failure', { kind: 'network', code: 'EAI_AGAIN' }, 'AMBIGUOUS_NETWORK', true],
  ['HTTP 429 with a short Retry-After', { kind: 'status', status: 429, headers: { 'retry-after': '1' } }, 'RATE_LIMITED', true],
  ['HTTP 429 without Retry-After', { kind: 'status', status: 429 }, 'RATE_LIMITED', true],
  ['HTTP 500', { kind: 'status', status: 500 }, 'AMBIGUOUS_NETWORK', false],
  ['HTTP 502', { kind: 'status', status: 502 }, 'AMBIGUOUS_NETWORK', true],
  ['HTTP 503', { kind: 'status', status: 503 }, 'AMBIGUOUS_NETWORK', true],
  ['HTTP 504', { kind: 'status', status: 504 }, 'AMBIGUOUS_NETWORK', true],
  ['HTTP 401', { kind: 'status', status: 401 }, 'INVALID_AUTH', false],
  ['HTTP 403', { kind: 'status', status: 403 }, 'NOT_ENTITLED', false],
  ['HTTP 422', { kind: 'status', status: 422 }, 'BROKER_REJECTED', false],
  ['malformed JSON', { kind: 'body', body: '{not json' }, 'MALFORMED_RESPONSE', false],
  ['truncated body', { kind: 'truncated' }, 'MALFORMED_RESPONSE', false],
  ['empty body', { kind: 'body', body: '' }, 'MALFORMED_RESPONSE', false],
  ['wrong content type', { kind: 'body', body: '<html>gateway</html>', contentType: 'text/html' }, 'MALFORMED_RESPONSE', false],
];

for (const [name, fault, category, retried] of readCases) {
  test(`READ by client order id, ${name}: classified ${category}, ${retried ? 'retried within bounds' : 'not retried'}, never mutates`, async () => {
    const rig = makeRig({ maxRetries: 2 });
    rig.server.seed({ symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', limit_price: '1.25', client_order_id: 'c-read', position_intent: 'sell_to_open' });
    rig.server.inject({ op: LOOKUP, times: 'always', respond: fault });
    const error = await caught(rig.adapter.getOrderByClientOrderId('c-read'));
    assert.ok(error, 'the always-failing read must surface an error, never empty data');
    assert.equal(error.category, category);
    assert.equal(rig.server.count(LOOKUP), retried ? 3 : 1, `attempts for ${name}`);
    assert.ok(rig.sleeps.reduce((a, b) => a + b, 0) <= 5000, 'total backoff is capped');
    assert.equal(rig.server.mutationCount(), 0, 'a read fault never mutates');
  });

  if (retried) {
    test(`READ by client order id, ${name}: a transient fault that clears is recovered by the bounded retry (no duplicate order)`, async () => {
      const rig = makeRig({ maxRetries: 2 });
      rig.server.seed({ symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', limit_price: '1.25', client_order_id: 'c-read', position_intent: 'sell_to_open' });
      rig.server.inject({ op: LOOKUP, times: 1, respond: fault });
      const order = await rig.adapter.getOrderByClientOrderId('c-read');
      assert.equal(order?.clientOrderId, 'c-read');
      assert.equal(rig.server.count(LOOKUP), 2);
      assert.equal(rig.server.created, 1);
    });
  }
}

test('READ: HTTP 404 by client order id is "not found" (null), HTTP 404 on the order list is a rejection; neither is retried', async () => {
  const rig = makeRig();
  assert.equal(await rig.adapter.getOrderByClientOrderId('missing'), null);
  assert.equal(rig.server.count(LOOKUP), 1);
  rig.server.inject({ op: LIST, respond: { kind: 'status', status: 404 } });
  const error = await caught(rig.adapter.getOrders('open'));
  assert.equal(error?.category, 'BROKER_REJECTED');
});

test('READ: the same matrix holds for the order list and the positions endpoint (transient faults retried, others typed)', async () => {
  for (const op of [LIST, POSITIONS]) {
    const call = (rig: ReturnType<typeof makeRig>) => op === LIST ? rig.adapter.getOrders('open') : rig.adapter.getPositions();
    const rig = makeRig({ maxRetries: 2 });
    rig.server.inject({ op, times: 1, respond: { kind: 'status', status: 503 } });
    await call(rig);
    assert.equal(rig.server.count(op), 2, `${op} recovered after one 503`);
    const down = makeRig({ maxRetries: 2 });
    down.server.inject({ op, times: 'always', respond: { kind: 'status', status: 401 } });
    assert.equal((await caught(call(down)))?.category, 'INVALID_AUTH');
    assert.equal(down.server.count(op), 1);
  }
});

test('READ: a long Retry-After is never slept through, and one 429 puts a process-wide cooldown on later reads (no retry storm)', async () => {
  const rig = makeRig({ maxRetries: 2 });
  rig.server.seed({ symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', limit_price: '1.25', client_order_id: 'c-read', position_intent: 'sell_to_open' });
  rig.server.inject({ op: LOOKUP, times: 'always', respond: { kind: 'status', status: 429, headers: { 'retry-after': '120' } } });
  const error = await caught(rig.adapter.getOrderByClientOrderId('c-read'));
  assert.equal(error?.category, 'RATE_LIMITED');
  assert.equal(error?.retryAfterMs, 120_000);
  assert.equal(rig.server.count(LOOKUP), 1, 'a Retry-After beyond the cap ends the attempt at once');
  assert.deepEqual(rig.sleeps, [], 'no sleep');
});

// -------------------------------------------------------------------------------------------------------------- SUBMIT
test('SUBMIT 429 (not processed): reconciled by client order id, found absent, REJECTED once; a later attempt is a NEW deterministic client order id, never a replay', async () => {
  const rig = makeRig();
  rig.server.inject({ op: POST, respond: { kind: 'status', status: 429, headers: { 'retry-after': '1' } } });
  const intent = await rig.coordinator.prepare(optionIntent());
  await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), (error) => error instanceof AlpacaPaperBrokerError && error.category === 'RATE_LIMITED');
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'REJECTED');
  assert.equal(rig.server.count(POST), 1);
  assert.equal(rig.server.created, 0);
  assert.ok(rig.server.count(LOOKUP) >= 1, 'a 429 is reconciled before the intent is called REJECTED');
  await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), /Invalid order-intent transition/);
  assert.equal(rig.server.count(POST), 1, 'REJECTED has no way back to SUBMITTING');
});

test('SUBMIT 422 "client_order_id must be unique" while the order already exists: the existing order is adopted, no second order', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent());
  rig.server.seed(intent.request);
  const adopted = await rig.coordinator.submit(intent.orderIntentId, optionGate);
  assert.equal(adopted?.clientOrderId, intent.request.client_order_id);
  assert.equal(rig.server.created, 1);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'ACKNOWLEDGED');
});

for (const [name, status] of [['401', 401], ['403', 403], ['422 validation', 422], ['400', 400]] as const) {
  test(`SUBMIT HTTP ${name}: a definite rejection - REJECTED after reconciliation finds nothing, error surfaced, nothing created`, async () => {
    const rig = makeRig();
    rig.server.inject({ op: POST, respond: { kind: 'status', status } });
    const intent = await rig.coordinator.prepare(optionIntent());
    await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), AlpacaPaperBrokerError);
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'REJECTED');
    assert.equal(rig.server.created, 0);
    assert.equal(rig.server.count(POST), 1);
  });
}

test('SUBMIT 429 followed by a failing reconciliation read: UNKNOWN_SUBMISSION (restart-recoverable), never REJECTED on a guess', async () => {
  const rig = makeRig({ maxRetries: 0 });
  rig.server.inject({ op: POST, respond: { kind: 'status', status: 429 } });
  rig.server.inject({ op: LOOKUP, times: 'always', respond: { kind: 'network', code: 'ECONNRESET' } });
  const intent = await rig.coordinator.prepare(optionIntent());
  await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate));
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'UNKNOWN_SUBMISSION');
  assert.equal(rig.server.count(POST), 1);
});

// -------------------------------------------------------------------------------------------------------------- CANCEL
for (const [name, fault] of [['timeout', { kind: 'timeout' }], ['ECONNRESET', { kind: 'network', code: 'ECONNRESET' }], ['HTTP 503', { kind: 'status', status: 503 }]] as const) {
  for (const applied of [true, false]) {
    test(`CANCEL ${name} (${applied ? 'applied' : 'not applied'}): UNKNOWN_SUBMISSION, reconciled from broker truth, the order is never cancelled twice or resubmitted`, async () => {
      const rig = makeRig();
      const intent = await rig.coordinator.prepare(optionIntent());
      await rig.coordinator.submit(intent.orderIntentId, optionGate);
      rig.server.inject({ op: DELETE, applied, respond: fault });
      await rig.coordinator.cancel(intent.orderIntentId, optionGate);
      const status = (await rig.store.getIntent(intent.orderIntentId))?.status;
      // applied: broker truth is CANCELED. not applied: broker truth is still the working order, so the intent returns to ACKNOWLEDGED
      // (RECONCILING resolves to what the broker proves) and the cancel may simply be requested again.
      assert.equal(status, applied ? 'CANCELED' : 'ACKNOWLEDGED');
      assert.equal(rig.server.count(POST), 1);
      assert.equal(rig.server.count(DELETE), 1, 'one DELETE only');
      assert.equal(rig.server.created, 1);
    });
  }
}

test('CANCEL 429: the error surfaces, the intent stays CANCEL_REQUESTED, and a later cancel is re-issued (idempotent at the broker)', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent());
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.inject({ op: DELETE, respond: { kind: 'status', status: 429 } });
  await assert.rejects(rig.coordinator.cancel(intent.orderIntentId, optionGate), (error) => error instanceof AlpacaPaperBrokerError && error.category === 'RATE_LIMITED');
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'CANCEL_REQUESTED');
  await rig.coordinator.cancel(intent.orderIntentId, optionGate);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'CANCELED');
  assert.equal(rig.server.created, 1);
});

for (const status of [404, 422]) {
  test(`CANCEL HTTP ${status} because the order filled between our read and the DELETE: broker truth wins (FILLED), no error`, async () => {
    const rig = makeRig();
    const intent = await rig.coordinator.prepare(optionIntent());
    await rig.coordinator.submit(intent.orderIntentId, optionGate);
    rig.server.inject({ op: DELETE, before: (server: FakeAlpaca) => server.patch(intent.request.client_order_id, { status: 'filled', filled_qty: String(intent.request.qty) }),
      respond: { kind: 'status', status } });
    const result = await rig.coordinator.cancel(intent.orderIntentId, optionGate);
    assert.equal(result?.status, 'filled');
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'FILLED');
  });
}

// ------------------------------------------------------------------------------------------------------------- REPLACE
test('REPLACE lost response, applied: the replacement is adopted, the original closed, exactly one live order', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(original, { limit: '189.9', attempt: 2 });
  rig.server.inject({ op: PATCH, applied: true, respond: { kind: 'timeout' } });
  const result = await rig.coordinator.replace(original.orderIntentId, replacement, stockGate);
  assert.equal(result?.clientOrderId, replacement.request.client_order_id);
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'CANCELED');
  assert.equal((await rig.store.getIntent(replacement.orderIntentId))?.status, 'ACKNOWLEDGED');
  const live = [...rig.server.orders.values()].filter((order) => order.status === 'accepted');
  assert.equal(live.length, 1);
  assert.equal(rig.server.count(PATCH), 1);
});

test('REPLACE lost response, NOT applied: the replacement is unresolved, the original stays the live order, nothing is duplicated', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(original, { limit: '189.9', attempt: 2 });
  rig.server.inject({ op: PATCH, applied: false, respond: { kind: 'status', status: 503 } });
  assert.equal(await rig.coordinator.replace(original.orderIntentId, replacement, stockGate), null);
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'ACKNOWLEDGED', 'the original is untouched');
  assert.equal((await rig.store.getIntent(replacement.orderIntentId))?.status, 'RECONCILING');
  assert.equal(rig.server.created, 1);
  assert.equal(rig.server.count(PATCH), 1);
});

test('REPLACE 422 because the original just filled: the original is synced from broker truth (FILLED) and the replacement is REJECTED', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(original, { limit: '189.9', attempt: 2 });
  rig.server.inject({ op: PATCH, before: (server: FakeAlpaca) => server.patch(original.request.client_order_id, { status: 'filled', filled_qty: String(original.request.qty) }),
    respond: { kind: 'status', status: 422 } });
  await assert.rejects(rig.coordinator.replace(original.orderIntentId, replacement, stockGate));
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'FILLED');
  assert.equal((await rig.store.getIntent(replacement.orderIntentId))?.status, 'REJECTED');
  assert.equal(rig.server.created, 1);
});

test('REPLACE 429 (not processed): the replacement is REJECTED after reconciliation, the original is untouched and keeps working', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(original, { limit: '189.9', attempt: 2 });
  rig.server.inject({ op: PATCH, respond: { kind: 'status', status: 429 } });
  await assert.rejects(rig.coordinator.replace(original.orderIntentId, replacement, stockGate), (error) => error instanceof AlpacaPaperBrokerError && error.category === 'RATE_LIMITED');
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'ACKNOWLEDGED');
  assert.equal((await rig.store.getIntent(replacement.orderIntentId))?.status, 'REJECTED');
  assert.equal(rig.server.created, 1);
});

test('REPLACE with a client order id that already exists at the broker (duplicate): the existing replacement is adopted, no second order', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent());
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  const replacement = replacementOf(original, { limit: '189.9', attempt: 2 });
  rig.server.seed({ ...replacement.request, position_intent: undefined } as never);
  const result = await rig.coordinator.replace(original.orderIntentId, replacement, stockGate);
  assert.equal(result?.clientOrderId, replacement.request.client_order_id);
  assert.equal(rig.server.created, 2, 'the original plus the one pre-existing replacement; the PATCH did not mint a third');
});

test('invariant over the whole campaign: every scripted fault ends in a persisted, recoverable state (no intent left in SUBMITTING)', async () => {
  const faults: FaultResponse[] = [{ kind: 'timeout' }, { kind: 'network', code: 'ECONNRESET' }, { kind: 'status', status: 429 },
    { kind: 'status', status: 500 }, { kind: 'status', status: 503 }, { kind: 'status', status: 401 }, { kind: 'status', status: 422 },
    { kind: 'body', body: '{bad' }, { kind: 'truncated' }];
  for (const fault of faults) for (const applied of [true, false]) {
    const rig = makeRig();
    rig.server.inject({ op: POST, applied, respond: fault });
    const intent = await rig.coordinator.prepare(optionIntent());
    await rig.coordinator.submit(intent.orderIntentId, optionGate).catch(() => undefined);
    const status = (await rig.store.getIntent(intent.orderIntentId))?.status;
    assert.notEqual(status, 'SUBMITTING', JSON.stringify(fault));
    assert.ok(rig.server.created <= 1, 'never more than one economic order');
    assert.equal(rig.server.count(POST), 1, 'never a second POST');
  }
});
