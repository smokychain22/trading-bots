// Phase 3 -- PARTIAL FILLS at the coordinator / state level.
//
// Owner Paper policy for a part-filled SELL_STOCK: never replaced, no replacement intent, the bounded DAY order rests; at terminal
// state the remainder is NOT resubmitted. Option part fills follow the same rule at this layer (a replacement may not erase or
// re-sell filled quantity). The ledger consequences (freeze, no fabricated lot P&L) are covered by phase3-sweep-and-freeze.
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRig, optionGate, optionIntent, replacementOf, stockGate, stockIntent } from './phase3-exec-fixtures.js';

const POST = 'POST /v2/orders';
const PATCH = 'PATCH /v2/orders/{id}';

test('option part fill: PARTIAL with the remaining quantity visible at the broker; remaining quantity is derived from broker truth only', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.patch(intent.request.client_order_id, { status: 'partially_filled', filled_qty: '1' });
  const broker = await rig.coordinator.reconcileIntent(intent.orderIntentId);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'PARTIAL');
  assert.equal(broker?.filledQty, 1);
  assert.equal((broker?.qty ?? 0) - (broker?.filledQty ?? 0), 2, 'remaining quantity is broker truth');
});

test('cancelling a part-filled option order cancels only the remainder: terminal CANCELED, filled quantity preserved, never resubmitted', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.patch(intent.request.client_order_id, { status: 'partially_filled', filled_qty: '1' });
  await rig.coordinator.reconcileIntent(intent.orderIntentId);
  await rig.coordinator.cancel(intent.orderIntentId, optionGate);
  const final = await rig.coordinator.reconcileIntent(intent.orderIntentId);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'CANCELED');
  assert.equal(final?.filledQty, 1, 'the fill survives the cancel');
  assert.equal(rig.server.count(POST), 1);
  assert.equal(rig.server.created, 1);
});

test('a fill that lands DURING the cancel is not lost: the order ends FILLED, not CANCELED', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.inject({ op: 'DELETE /v2/orders/{id}', before: (server) => server.patch(intent.request.client_order_id, { status: 'filled', filled_qty: '3' }),
    respond: { kind: 'status', status: 422 } });
  await rig.coordinator.cancel(intent.orderIntentId, optionGate);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'FILLED');
});

test('a replacement may never erase filled quantity or raise exposure (option order)', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(original.orderIntentId, optionGate);
  rig.server.patch(original.request.client_order_id, { status: 'partially_filled', filled_qty: '2' });
  await rig.coordinator.reconcileIntent(original.orderIntentId);
  for (const qty of [1, 2, 4]) {
    await assert.rejects(rig.coordinator.replace(original.orderIntentId, replacementOf(original, { qty, attempt: 2 + qty }), optionGate),
      /REPLACEMENT_QUANTITY_MAY_NOT_INCREASE_EXPOSURE/, `replacement qty ${qty}`);
  }
  assert.equal(rig.server.count(PATCH), 0, 'the broker was never asked to replace');
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'PARTIAL');
});

test('owner Paper policy: a part-filled SELL_STOCK order is NEVER replaced - no PATCH, no replacement intent, whatever the quantity', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent({ qty: 100 }));
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  rig.server.patch(original.request.client_order_id, { status: 'partially_filled', filled_qty: '40' });
  await rig.coordinator.reconcileIntent(original.orderIntentId);
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'PARTIAL');
  const attempt = replacementOf(original, { qty: 100, attempt: 2, limit: '189.5' });
  await assert.rejects(rig.coordinator.replace(original.orderIntentId, attempt, stockGate), /PARTIAL_STOCK_SELL_REPLACE_FORBIDDEN/);
  assert.equal(rig.server.count(PATCH), 0);
  assert.equal(await rig.store.getIntent(attempt.orderIntentId), null, 'the forbidden replacement intent was not even persisted');
  assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'PARTIAL', 'the working order rests');
});

test('terminal partial SELL_STOCK (session ends): CANCELED with the filled quantity preserved; repeated reconciliation never resubmits the remainder', async () => {
  const rig = makeRig();
  const original = await rig.coordinator.prepare(stockIntent({ qty: 100 }));
  await rig.coordinator.submit(original.orderIntentId, stockGate);
  rig.server.patch(original.request.client_order_id, { status: 'partially_filled', filled_qty: '40' });
  await rig.coordinator.reconcileIntent(original.orderIntentId);
  rig.server.patch(original.request.client_order_id, { status: 'expired', filled_qty: '40' }); // the DAY order ends at the close
  for (let pass = 0; pass < 3; pass += 1) {
    const broker = await rig.coordinator.reconcileIntent(original.orderIntentId);
    assert.equal(broker?.filledQty, 40);
    assert.equal((await rig.store.getIntent(original.orderIntentId))?.status, 'CANCELED');
  }
  assert.deepEqual(await rig.coordinator.recoverAfterRestart('2026-10-02T21:00:00.000Z'), [], 'nothing unresolved to recover');
  assert.equal(rig.server.count(POST), 1, 'the unsold 60 shares are never auto-resubmitted');
  assert.equal(rig.server.count(PATCH), 0);
  assert.equal(rig.server.created, 1);
});

test('restart while PARTIAL: a fresh coordinator over the same store resumes from broker truth (PARTIAL then FILLED) without any new order', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.patch(intent.request.client_order_id, { status: 'partially_filled', filled_qty: '1' });
  await rig.coordinator.reconcileIntent(intent.orderIntentId);
  const restarted = makeRig({ server: rig.server, store: rig.store });
  await restarted.coordinator.recoverAfterRestart('2026-10-02T14:10:00.000Z');
  assert.equal((await restarted.store.getIntent(intent.orderIntentId))?.status, 'PARTIAL');
  rig.server.patch(intent.request.client_order_id, { status: 'filled', filled_qty: '3' });
  await restarted.coordinator.reconcileIntent(intent.orderIntentId);
  assert.equal((await restarted.store.getIntent(intent.orderIntentId))?.status, 'FILLED');
  assert.equal(rig.server.count(POST), 1);
});

test('a part-filled order that the broker marks done_for_day is terminal (never PARTIAL forever) with the fill preserved', async () => {
  const rig = makeRig();
  const intent = await rig.coordinator.prepare(optionIntent({ qty: 3 }));
  await rig.coordinator.submit(intent.orderIntentId, optionGate);
  rig.server.patch(intent.request.client_order_id, { status: 'partially_filled', filled_qty: '1' });
  await rig.coordinator.reconcileIntent(intent.orderIntentId);
  rig.server.patch(intent.request.client_order_id, { status: 'done_for_day', filled_qty: '1' });
  await rig.coordinator.reconcileIntent(intent.orderIntentId);
  assert.equal((await rig.store.getIntent(intent.orderIntentId))?.status, 'CANCELED');
});
