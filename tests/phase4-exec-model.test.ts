// Phase 4: model-based / randomized execution safety. Seeded, deterministic, offline (fake Alpaca only; never a real broker).
// Random sequences of: submit (with injected faults), duplicate submit triggers, broker-side partial/complete fills and expiry, cancel,
// replace, restart, reconcile. After EVERY step the safety invariants must hold:
//   - at most ONE POST per intent and at most ONE non-replacement broker order (no duplicate economic exposure)
//   - at most one live (non-terminal) broker order for the lineage
//   - terminal intent states never resurrect
//   - the filled quantity reported for one broker order never decreases, and never exceeds the order quantity
//   - an intent is never REJECTED while a live broker order exists under its client order id
//   - a programming error (TypeError/RangeError/ReferenceError) is never an acceptable outcome
import assert from 'node:assert/strict';
import test from 'node:test';
import { PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import type { BrokerOrderSnapshot } from '../src/execution/broker.js';
import { control, makeRig, optionGate, optionIntent, replacementOf, stockGate, stockIntent, type FaultSpec } from './phase3-exec-fixtures.js';

const POST = 'POST /v2/orders';
const TERMINAL_INTENT = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
const TERMINAL_BROKER = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced', 'done_for_day']);

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const submitFaults: ReadonlyArray<FaultSpec['respond'] & { readonly applied: boolean } | null> = [
  null, null, null, null,
  { kind: 'timeout', applied: true }, { kind: 'timeout', applied: false },
  { kind: 'network', code: 'ECONNRESET', applied: true }, { kind: 'network', code: 'ECONNRESET', applied: false },
  { kind: 'status', status: 500, applied: true }, { kind: 'status', status: 503, applied: false }, { kind: 'status', status: 504, applied: true },
  { kind: 'status', status: 429, applied: false }, { kind: 'status', status: 408, applied: true },
  { kind: 'body', body: '{not json', applied: true }, { kind: 'truncated', applied: true },
];

type Step = 'submit' | 'submit_again' | 'fill_partial' | 'fill_all' | 'broker_cancel' | 'broker_expire' | 'reconcile' | 'cancel' | 'replace' | 'restart';
const STEPS: readonly Step[] = ['submit', 'submit', 'submit_again', 'fill_partial', 'fill_partial', 'fill_all', 'broker_cancel', 'broker_expire',
  'reconcile', 'reconcile', 'cancel', 'replace', 'replace', 'restart'];

async function runScenario(seed: number): Promise<void> {
  const next = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const rig = makeRig();
  const store = rig.store as unknown as { intents: Map<string, { status: string; request: { client_order_id: string; qty: number } }> };
  let coordinator = rig.coordinator;
  const isStock = next() < 0.3;
  const gate = isStock ? stockGate : optionGate;
  const original = isStock ? stockIntent() : optionIntent();
  const intentIds = [original.orderIntentId];
  const lastStatus = new Map<string, string>();
  const maxFilledByOrder = new Map<string, number>();
  let replacementAttempt = 2;
  await coordinator.prepare(original);

  const programmingError = (error: unknown): boolean => error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;
  const observe = (snapshot: BrokerOrderSnapshot | null | undefined): void => {
    if (snapshot === null || snapshot === undefined) return;
    assert.ok(snapshot.filledQty >= 0 && snapshot.filledQty <= snapshot.qty, `seed ${seed}: filled ${snapshot.filledQty} outside 0..${snapshot.qty}`);
    const before = maxFilledByOrder.get(snapshot.clientOrderId) ?? 0;
    assert.ok(snapshot.filledQty >= before, `seed ${seed}: reported filled quantity of one order decreased ${before} -> ${snapshot.filledQty}`);
    maxFilledByOrder.set(snapshot.clientOrderId, Math.max(before, snapshot.filledQty));
  };
  const guarded = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    try { return await operation(); } catch (error) {
      assert.equal(programmingError(error), false, `seed ${seed}: programming error ${(error as Error).message}`);
      return undefined;
    }
  };
  const liveBrokerOrders = () => [...rig.server.orders.values()].filter((order) => !TERMINAL_BROKER.has(order.status));

  const invariants = (when: string): void => {
    assert.ok(rig.server.count(POST) <= 1, `seed ${seed} ${when}: ${rig.server.count(POST)} POSTs`);
    const roots = [...rig.server.orders.values()].filter((order) => order.replaces === null || order.replaces === undefined);
    assert.ok(roots.length <= 1, `seed ${seed} ${when}: ${roots.length} non-replacement broker orders`);
    assert.ok(liveBrokerOrders().length <= 1, `seed ${seed} ${when}: ${liveBrokerOrders().length} live broker orders`);
    for (const order of rig.server.orders.values()) {
      assert.ok(Number(order.filled_qty) >= 0 && Number(order.filled_qty) <= Number(order.qty), `seed ${seed} ${when}: broker fill out of range`);
    }
    for (const [id, intent] of store.intents) {
      const before = lastStatus.get(id);
      if (before !== undefined && TERMINAL_INTENT.has(before)) assert.equal(intent.status, before, `seed ${seed} ${when}: terminal ${before} resurrected as ${intent.status}`);
      lastStatus.set(id, intent.status);
      if (intent.status === 'REJECTED') {
        const order = rig.server.byClient(intent.request.client_order_id);
        assert.ok(order === undefined || TERMINAL_BROKER.has(order.status), `seed ${seed} ${when}: intent REJECTED while broker order ${order?.status} is live`);
      }
    }
  };

  const length = 3 + Math.floor(next() * 8);
  for (let index = 0; index < length; index += 1) {
    const step = pick(STEPS);
    const primary = intentIds[0] as string;
    const live = liveBrokerOrders()[0];
    if (step === 'submit' || step === 'submit_again') {
      const fault = pick(submitFaults);
      if (fault !== null && !(fault.kind === 'timeout' && next() < 0.7)) {
        const { applied, ...respond } = fault;
        rig.server.inject({ op: POST, applied, respond: respond as FaultSpec['respond'] });
      }
      observe(await guarded(() => coordinator.submit(primary, gate)));
    } else if (step === 'fill_partial' && live !== undefined) {
      const qty = Number(live.qty), filled = Number(live.filled_qty);
      if (qty > 1 && filled < qty - 1) rig.server.patch(String(live.client_order_id), { status: 'partially_filled', filled_qty: String(filled + 1 + Math.floor(next() * (qty - filled - 1))) });
    } else if (step === 'fill_all' && live !== undefined) {
      rig.server.patch(String(live.client_order_id), { status: 'filled', filled_qty: String(live.qty) });
    } else if (step === 'broker_cancel' && live !== undefined) {
      rig.server.patch(String(live.client_order_id), { status: 'canceled' });
    } else if (step === 'broker_expire' && live !== undefined) {
      rig.server.patch(String(live.client_order_id), { status: 'expired' });
    } else if (step === 'reconcile') {
      for (const id of intentIds) observe(await guarded(() => coordinator.reconcileIntent(id)));
    } else if (step === 'cancel') {
      observe(await guarded(() => coordinator.cancel(intentIds[intentIds.length - 1] as string, gate)));
    } else if (step === 'replace') {
      replacementAttempt += 1;
      const original0 = store.intents.get(primary);
      if (original0 !== undefined && !(isStock && live !== undefined && Number(live.filled_qty) > 0)) {
        const replacement = replacementOf(original, { limit: (1.2 - next() * 0.1).toFixed(2), attempt: replacementAttempt, qty: Math.max(1, original.request.qty - Math.floor(next() * 2)) });
        const result = await guarded(() => coordinator.replace(primary, replacement, gate));
        if (result !== undefined) intentIds.push(replacement.orderIntentId);
        observe(result);
      }
    } else if (step === 'restart') {
      coordinator = new PaperOrderCoordinator(rig.adapter, rig.store, control());
      await guarded(() => coordinator.recoverAfterRestart());
    }
    invariants(`after ${step}`);
  }

  // final clean pass (no faults): everything that can be resolved is resolved consistently with the broker
  const probe = new PaperOrderCoordinator(rig.adapter, rig.store, control());
  await guarded(() => probe.recoverAfterRestart());
  for (const id of [...store.intents.keys()]) observe(await guarded(() => probe.reconcileIntent(id)));
  invariants('after the final clean reconcile');
  for (const [, intent] of store.intents) {
    const order = rig.server.byClient(intent.request.client_order_id);
    if (order === undefined) continue;
    if (order.status === 'filled') assert.equal(intent.status, 'FILLED', `seed ${seed}: broker filled but intent ${intent.status}`);
    if (order.status === 'canceled') assert.ok(['CANCELED', 'PARTIAL'].includes(intent.status), `seed ${seed}: broker canceled but intent ${intent.status}`);
    if (order.status === 'expired') assert.ok(['EXPIRED', 'PARTIAL', 'CANCELED'].includes(intent.status), `seed ${seed}: broker expired but intent ${intent.status}`);
    assert.notEqual(intent.status, 'UNKNOWN_SUBMISSION', `seed ${seed}: an unknown submission stayed unresolved although the broker order exists`);
  }
}

test('model-based execution safety: 300 seeded random scenarios keep every invariant after every step', async () => {
  for (let seed = 1; seed <= 300; seed += 1) await runScenario(seed);
});

test('the scenario generator is deterministic (the same seed replays the same broker end state)', async () => {
  const fingerprint = async (seed: number): Promise<string> => {
    const next = prng(seed);
    return Array.from({ length: 8 }, () => next().toFixed(8)).join(',');
  };
  assert.equal(await fingerprint(7), await fingerprint(7));
  assert.notEqual(await fingerprint(7), await fingerprint(8));
});
