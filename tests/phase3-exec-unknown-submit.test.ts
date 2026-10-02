// Phase 3 E1 task 2 -- UNKNOWN-SUBMIT SAFETY.
//
// Invariant under test: an ambiguous POST (lost response, timeout, connection reset, 5xx after acceptance, malformed 200 body)
// puts the intent in UNKNOWN_SUBMISSION and it is RECONCILED by deterministic client_order_id before anything else. No code path
// ever issues a second POST for the same intent, so there is never a second economically identical broker order.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PaperOrderCoordinator, absentUnknownSubmissionGraceMs } from '../src/execution/paper-order-coordinator.js';
import { dbSkip, FakeAlpaca, makeRig, openPool, optionGate, optionIntent, postgresStore, control, relaxExecutionForeignKeys, type FaultResponse } from './phase3-exec-fixtures.js';

const POST = 'POST /v2/orders';
const LOOKUP = 'GET /v2/orders:by_client_order_id';

const ambiguousFaults: ReadonlyArray<readonly [string, FaultResponse]> = [
  ['lost response / timeout after POST', { kind: 'timeout' }],
  ['connection reset', { kind: 'network', code: 'ECONNRESET' }],
  ['HTTP 500 after acceptance', { kind: 'status', status: 500 }],
  ['HTTP 502 after acceptance', { kind: 'status', status: 502 }],
  ['HTTP 503 after acceptance', { kind: 'status', status: 503 }],
  ['HTTP 504 after acceptance', { kind: 'status', status: 504 }],
  ['malformed 200 body', { kind: 'body', body: '{not json' }],
  ['truncated 200 body', { kind: 'truncated' }],
  ['200 with a body that is not an order', { kind: 'body', body: '{"ok":true}' }],
  ['200 with an empty body', { kind: 'body', body: '' }],
];

for (const [name, fault] of ambiguousFaults) {
  test(`${name}: order WAS applied -> UNKNOWN_SUBMISSION, reconciled by client_order_id, exactly one broker order, no second POST`, async () => {
    const rig = makeRig();
    rig.server.inject({ op: POST, applied: true, respond: fault });
    const intent = await rig.coordinator.prepare(optionIntent());
    const result = await rig.coordinator.submit(intent.orderIntentId, optionGate);
    assert.equal(result?.clientOrderId, intent.request.client_order_id);
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'ACKNOWLEDGED');
    assert.equal(rig.server.count(POST), 1);
    assert.equal(rig.server.created, 1);
    assert.equal(rig.server.orders.size, 1);
    assert.ok(rig.server.count(LOOKUP) >= 1);
    // the lookup came strictly after the single POST
    const ops = rig.server.log.map((entry) => entry.op);
    assert.ok(ops.indexOf(LOOKUP) > ops.indexOf(POST));
    // a second submit call cannot reach the broker: ACKNOWLEDGED has no edge back to SUBMITTING
    await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), /Invalid order-intent transition/);
    assert.equal(rig.server.count(POST), 1);
  });

  test(`${name}: order was NOT applied -> stays RECONCILING (unresolved), never resubmitted, expires only after the grace window`, async () => {
    const rig = makeRig();
    rig.server.inject({ op: POST, applied: false, respond: fault });
    const intent = await rig.coordinator.prepare(optionIntent());
    assert.equal(await rig.coordinator.submit(intent.orderIntentId, optionGate), null);
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'RECONCILING');
    await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), /Invalid order-intent transition/);
    assert.equal(rig.server.count(POST), 1);
    assert.equal(rig.server.created, 0);
    const windowEnd = Date.parse(intent.executionEvidence.decisionExpiresAt);
    // inside the decision window and inside the grace period: unresolved, no state change, no POST
    for (const offset of [-60_000, 0, absentUnknownSubmissionGraceMs - 1, absentUnknownSubmissionGraceMs]) {
      const out = await rig.coordinator.recoverAfterRestart(new Date(windowEnd + offset).toISOString());
      assert.deepEqual(out, [{ orderIntentId: intent.orderIntentId, resolved: false }]);
      assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'RECONCILING');
    }
    // strictly after window + grace: terminal EXPIRED, still never a POST
    const expired = await rig.coordinator.recoverAfterRestart(new Date(windowEnd + absentUnknownSubmissionGraceMs + 1).toISOString());
    assert.deepEqual(expired, [{ orderIntentId: intent.orderIntentId, resolved: true }]);
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'EXPIRED');
    assert.equal(rig.server.count(POST), 1);
    assert.equal(rig.server.created, 0);
    assert.deepEqual(await rig.store.unresolvedIntents(), []);
    await assert.rejects(rig.coordinator.submit(intent.orderIntentId, optionGate), /Invalid order-intent transition/);
  });
}

test('the execution attempt records timeout_flag and reconcile_before_retry for an ambiguous POST', async () => {
  const rig = makeRig();
  rig.server.inject({ op: POST, applied: true, respond: { kind: 'network', code: 'ECONNRESET' } });
  const intent = await rig.coordinator.prepare(optionIntent());
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  const store = rig.store as import('../src/execution/paper-order-coordinator.js').InMemoryPaperOrderStore;
  const attempt = store.attempts.get(`${intent.orderIntentId}:1`);
  assert.equal(attempt?.timeoutFlag, true);
  assert.equal(attempt?.reconcileBeforeRetry, true);
  assert.equal(store.attempts.size, 1);
});

test('a slow broker that accepts the order after the first lookup is picked up by the next recovery pass, never resubmitted', async () => {
  const rig = makeRig();
  rig.server.inject({ op: POST, applied: false, respond: { kind: 'timeout' } });
  const intent = await rig.coordinator.prepare(optionIntent());
  assert.equal(await rig.coordinator.submit(intent.orderIntentId, optionGate), null);
  rig.server.seed(intent.request); // the broker finally accepted it
  const [outcome] = await rig.coordinator.recoverAfterRestart(optionGate.now);
  assert.deepEqual(outcome, { orderIntentId: intent.orderIntentId, resolved: true });
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'ACKNOWLEDGED');
  assert.equal(rig.server.count(POST), 1);
  assert.equal(rig.server.created, 1);
});

test('restart while SUBMITTING: a new coordinator recovers via recoverAfterRestart without any POST (order present at broker)', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent());
  await rig.store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING'); // crash right after the durable SUBMITTING write
  rig.server.seed(intent.request);
  const restarted = new PaperOrderCoordinator(rig.adapter, rig.store, control());
  const out = await restarted.recoverAfterRestart(optionGate.now);
  assert.deepEqual(out, [{ orderIntentId: intent.orderIntentId, resolved: true }]);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'ACKNOWLEDGED');
  assert.equal(rig.server.count(POST), 0);
});

test('restart while SUBMITTING with the order absent at the broker: unresolved inside the grace window, EXPIRED after, no POST ever', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent());
  await rig.store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
  const restarted = new PaperOrderCoordinator(rig.adapter, rig.store, control());
  const windowEnd = Date.parse(intent.executionEvidence.decisionExpiresAt);
  assert.deepEqual(await restarted.recoverAfterRestart(new Date(windowEnd).toISOString()), [{ orderIntentId: intent.orderIntentId, resolved: false }]);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'RECONCILING');
  assert.deepEqual(await restarted.recoverAfterRestart(new Date(windowEnd + absentUnknownSubmissionGraceMs + 1).toISOString()), [{ orderIntentId: intent.orderIntentId, resolved: true }]);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'EXPIRED');
  assert.equal(rig.server.count(POST), 0);
});

test('restart while UNKNOWN_SUBMISSION and while RECONCILING recover from broker truth (filled order resolves to FILLED)', async () => {
  for (const startState of ['UNKNOWN_SUBMISSION', 'RECONCILING'] as const) {
    const rig = makeRig();
    const intent = await rig.coordinator.prepare(optionIntent());
    await rig.store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
    await rig.store.transitionIntent(intent.orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
    if (startState === 'RECONCILING') await rig.store.transitionIntent(intent.orderIntentId, 'UNKNOWN_SUBMISSION', 'RECONCILING');
    const order = rig.server.seed(intent.request);
    order.status = 'filled'; order.filled_qty = String(intent.request.qty); order.filled_avg_price = '1.25';
    const [outcome] = await new PaperOrderCoordinator(rig.adapter, rig.store, control()).recoverAfterRestart(optionGate.now);
    assert.deepEqual(outcome, { orderIntentId: intent.orderIntentId, resolved: true });
    assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'FILLED');
    assert.equal(rig.server.count(POST), 0);
  }
});

test('recovery of one intent survives a broker outage on another and stops reading after a 429 (no retry storm)', async () => {
  const rig = makeRig({ maxRetries: 0 });
  const a = await rig.coordinator.prepare(optionIntent());
  const b = await rig.coordinator.prepare(optionIntent());
  const c = await rig.coordinator.prepare(optionIntent());
  for (const intent of [a, b, c]) await rig.store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
  rig.server.inject({ op: LOOKUP, respond: { kind: 'status', status: 503 } }); // first lookup: outage
  rig.server.inject({ op: LOOKUP, respond: { kind: 'status', status: 429 } }); // second lookup: rate limited
  const out = await rig.coordinator.recoverAfterRestart(optionGate.now);
  assert.equal(out.length, 3);
  assert.ok(out.every((item) => item.resolved === false));
  assert.equal(rig.server.count(LOOKUP), 2, 'no broker read is issued after the 429 within the same pass');
  assert.equal(rig.server.count(POST), 0);
});

test('idempotent re-prepare returns the persisted intent unchanged; any altered payload is ORDER_INTENT_IDEMPOTENCY_COLLISION', async () => {
  const rig = makeRig();
  const base = optionIntent();
  const first = await rig.coordinator.prepare(base);
  assert.deepEqual(await rig.coordinator.prepare(base), first);
  await rig.coordinator.submit(base.orderIntentId, optionGate);
  const afterSubmit = await rig.coordinator.prepare(base);
  assert.equal(afterSubmit.status, 'ACKNOWLEDGED', 're-prepare never resets or re-arms a submitted intent');
  const altered = [
    { ...base, request: { ...base.request, limit_price: '1.26' } },
    { ...base, request: { ...base.request, qty: 2 }, authorizationEvidence: { ...base.authorizationEvidence, paperEvidenceQuantity: 2 } },
    { ...base, request: { ...base.request, symbol: 'AAPL261016P00155000' } },
    { ...base, action: 'CLOSE_CSP' },
    { ...base, executionAccountId: '99999999-9999-4999-8999-999999999999' },
    { ...base, executionEvidence: { ...base.executionEvidence, quoteContentHash: 'b'.repeat(64) } },
  ];
  for (const candidate of altered) await assert.rejects(rig.coordinator.prepare(candidate), /ORDER_INTENT_IDEMPOTENCY_COLLISION/);
  // a different intent id reusing the same client_order_id can never be inserted
  await assert.rejects(rig.coordinator.prepare({ ...base, orderIntentId: randomUUID() }), /Duplicate client_order_id/);
  assert.equal(rig.server.count(POST), 1);
});

test('two concurrent submit calls for one intent: exactly one reaches the broker (in-memory store transition guard)', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent());
  const settled = await Promise.allSettled([rig.coordinator.submit(intent.orderIntentId, optionGate), rig.coordinator.submit(intent.orderIntentId, optionGate)]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((s) => s.status === 'rejected').length, 1);
  assert.equal(rig.server.count(POST), 1);
  assert.equal(rig.server.created, 1);
});

test('two concurrent submit calls from two coordinators sharing one intent: exactly one reaches the broker', async () => {
  const rig = makeRig();
  const other = new PaperOrderCoordinator(rig.adapter, rig.store, control());
  const intent = await rig.coordinator.prepare(optionIntent());
  const settled = await Promise.allSettled([rig.coordinator.submit(intent.orderIntentId, optionGate), other.submit(intent.orderIntentId, optionGate)]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.equal(rig.server.count(POST), 1);
});

test('Postgres: concurrent submits from separate pool connections let exactly one through; ambiguous POST reconciles by client id', { skip: dbSkip }, async () => {
  const pool = openPool();
  try {
    await relaxExecutionForeignKeys(pool);
    const accountId = randomUUID();
    const store = postgresStore(pool, accountId);
    const server = new FakeAlpaca();
    const rig = makeRig({ server, store });
    const intent = await rig.coordinator.prepare(optionIntent({ accountId }));
    const second = new PaperOrderCoordinator(rig.adapter, postgresStore(pool, accountId), control());
    const settled = await Promise.allSettled([rig.coordinator.submit(intent.orderIntentId, optionGate), second.submit(intent.orderIntentId, optionGate)]);
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
    assert.equal(server.count(POST), 1);
    assert.equal((await store.getIntent(intent.orderIntentId))?.status, 'ACKNOWLEDGED');

    // ambiguous POST on Postgres: restart-recoverable and reconciled by client order id
    const lost = await rig.coordinator.prepare(optionIntent({ accountId }));
    server.inject({ op: POST, applied: false, respond: { kind: 'timeout' } });
    assert.equal(await rig.coordinator.submit(lost.orderIntentId, optionGate), null);
    assert.equal((await store.getIntent(lost.orderIntentId))?.status, 'RECONCILING');
    assert.deepEqual((await store.unresolvedIntents()).map((i) => i.orderIntentId), [lost.orderIntentId]);
    server.seed(lost.request);
    const [outcome] = await new PaperOrderCoordinator(rig.adapter, postgresStore(pool, accountId), control()).recoverAfterRestart(optionGate.now);
    assert.deepEqual(outcome, { orderIntentId: lost.orderIntentId, resolved: true });
    assert.equal((await store.getIntent(lost.orderIntentId))?.status, 'ACKNOWLEDGED');
    // altered payload / duplicate client order id on the real store
    await assert.rejects(rig.coordinator.prepare({ ...lost, request: { ...lost.request, limit_price: '9.99' } }), /ORDER_INTENT_IDEMPOTENCY_COLLISION/);
    const persisted = await store.getIntent(lost.orderIntentId);
    assert.ok(persisted);
    await assert.rejects(store.insertIntent({ ...persisted, orderIntentId: randomUUID(), status: 'READY' }), /order_intent_client_order_id_key|duplicate key/);
  } finally {
    await pool.end();
  }
});
