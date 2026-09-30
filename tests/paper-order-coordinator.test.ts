import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerError, type BrokerOrderRequest, type BrokerOrderSnapshot, type PaperBrokerAdapter } from '../src/execution/broker.js';
import { executionMode, type ExecutionGateContext, type PaperExecutionControl } from '../src/execution/execution-control.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';
import { ORDER_INTENT_TRANSITIONS } from '../src/theta/order-intent-state.js';

const order: BrokerOrderRequest = { symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: '1.25', client_order_id: 'theta-test-1' };
const brokerOrder: BrokerOrderSnapshot = { id: 'broker-1', clientOrderId: order.client_order_id, symbol: order.symbol, qty: 1, filledQty: 0, filledAvgPrice: null, side: 'sell', status: 'accepted', limitPrice: 1.25, submittedAt: '2026-09-11T14:30:00Z', replacedBy: null, replaces: null };

class MockBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const;
  readonly environment = 'PAPER' as const;
  submitCalls = 0;
  cancelCalls = 0;
  replaceCalls = 0;
  lookupCalls = 0;
  submitError: Error | null = null;
  lookupResult: BrokerOrderSnapshot | null = null;
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => [];
  getActivities = async () => [];
  replaceOrder = async (_id: string, replacement: Pick<BrokerOrderRequest, 'qty'|'limit_price'|'time_in_force'|'client_order_id'>) => {
    this.replaceCalls += 1;
    const result = { ...brokerOrder, id: 'broker-2', clientOrderId: replacement.client_order_id,
      qty: replacement.qty, limitPrice: Number(replacement.limit_price), status: 'accepted', replaces: 'broker-1' };
    this.lookupResult = result; return result;
  };
  cancelOrder = async () => { this.cancelCalls += 1; this.lookupResult = { ...brokerOrder, status: 'canceled' }; };
  getOrderByClientOrderId = async () => { this.lookupCalls += 1; return this.lookupResult; };
  getOrder = async () => this.lookupResult;
  submitOrder = async () => { this.submitCalls += 1; if (this.submitError) throw this.submitError; return brokerOrder; };
}

const control = (overrides: Partial<PaperExecutionControl> = {}): PaperExecutionControl => ({ masterEnabled: false, followerEnabled: false, pauseNewOrders: true, ...overrides });
const gate: Omit<ExecutionGateContext, 'intentPersisted' | 'accountKind' | 'environment' | 'clientOrderId' | 'quantity'> = {
  baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true,
  aegisState: 'ALLOW_FULL', quoteFresh: true, decisionExpiresAt: '2026-09-11T15:00:00Z', now: '2026-09-11T14:00:00Z', isNewEntry: true,
  priceEvidence: 'QUALIFIED_OPTION_BBO',
};
const executionLineage = { chainId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',optionContractId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  underlyingId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',executionEvidence:{quoteSource:'ALPACA' as const,quoteFeed:'OPRA' as const,quoteSemantics:'CONSOLIDATED_NBBO' as const,
    quoteAsOf:'2026-09-11T14:00:00Z',decisionExpiresAt:'2026-09-11T15:00:00Z',quoteContentHash:'a'.repeat(64),aegisState:'ALLOW_FULL' as const},
  authorizationEvidence:{executionTier:'PAPER_EVIDENCE' as const,canonicalQuantity:1,paperEvidenceQuantity:1,
    empiricalEconomicsReady:false,expectedAfterCostEv:null}};
const prepare = async (coordinator: PaperOrderCoordinator) => coordinator.prepare({ orderIntentId: '11111111-1111-4111-8111-111111111111', executionAccountId: '22222222-2222-4222-8222-222222222222', request: order, action: 'OPEN_CSP', decisionId: '33333333-3333-4333-8333-333333333333', persistedAt: gate.now, ...executionLineage });

test('execution defaults LOCKED and cannot call the broker', async () => {
  const broker = new MockBroker(); const store = new InMemoryPaperOrderStore(); const coordinator = new PaperOrderCoordinator(broker, store, control());
  await prepare(coordinator);
  await assert.rejects(coordinator.submit('11111111-1111-4111-8111-111111111111', gate), /MASTER_EXECUTION_DISABLED/);
  assert.equal(broker.submitCalls, 0);
  assert.equal(executionMode(control(), 'MASTER_API_KEY'), 'LOCKED');
});

test('invalid temporal truth cannot submit even when Paper execution is enabled', async () => {
  for (const invalid of [{ now: '' }, { decisionExpiresAt: 'invalid' }]) {
    const broker = new MockBroker();
    const coordinator = new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), control({ masterEnabled: true, pauseNewOrders: false }));
    await prepare(coordinator);
    await assert.rejects(coordinator.submit('11111111-1111-4111-8111-111111111111', { ...gate, ...invalid }), /DECISION_TIME_INVALID/);
    assert.equal(broker.submitCalls, 0);
  }
});
test('even enabled execution remains READY while PAUSE NEW ORDERS is active', async () => {
  const broker = new MockBroker(); const store = new InMemoryPaperOrderStore(); const c = control({ masterEnabled: true });
  const coordinator = new PaperOrderCoordinator(broker, store, c); await prepare(coordinator);
  await assert.rejects(coordinator.submit('11111111-1111-4111-8111-111111111111', gate), /NEW_ORDERS_PAUSED/);
  assert.equal(broker.submitCalls, 0); assert.equal(executionMode(c, 'MASTER_API_KEY'), 'READY');
});

test('a fully released mock PAPER submission persists intent and attempt before the broker call', async () => {
  const broker = new MockBroker(); const store = new InMemoryPaperOrderStore(); const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator); const result = await coordinator.submit('11111111-1111-4111-8111-111111111111', gate);
  assert.equal(result?.id, 'broker-1'); assert.equal(broker.submitCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'ACKNOWLEDGED');
  assert.equal(store.attempts.size, 1);
});

test('ambiguous submission reconciles by client_order_id and never retries submit', async () => {
  const broker = new MockBroker(); broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout'); broker.lookupResult = brokerOrder;
  const store = new InMemoryPaperOrderStore(); const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator); const result = await coordinator.submit('11111111-1111-4111-8111-111111111111', gate);
  assert.equal(result?.id, 'broker-1'); assert.equal(broker.submitCalls, 1); assert.equal(broker.lookupCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'ACKNOWLEDGED');
});

test('ambiguous submission absent at broker stays RECONCILING and never blindly retries', async () => {
  const broker = new MockBroker(); broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout');
  const store = new InMemoryPaperOrderStore(); const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator); const result = await coordinator.submit('11111111-1111-4111-8111-111111111111', gate);
  assert.equal(result, null); assert.equal(broker.submitCalls, 1); assert.equal(broker.lookupCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'RECONCILING');
});

test('restart recovery reconciles an interrupted submission without submitting', async () => {
  const broker = new MockBroker(); broker.lookupResult = brokerOrder; const store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control()); await prepare(coordinator);
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'READY', 'SUBMITTING');
  const results = await coordinator.recoverAfterRestart();
  assert.deepEqual(results, [{ orderIntentId: '11111111-1111-4111-8111-111111111111', resolved: true }]);
  assert.equal(broker.submitCalls, 0); assert.equal(broker.lookupCalls, 1);
});

test('option submission rejects stock-price evidence before calling the broker', async () => {
  const broker = new MockBroker();
  const coordinator = new PaperOrderCoordinator(broker, new InMemoryPaperOrderStore(), control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator);
  await assert.rejects(
    coordinator.submit('11111111-1111-4111-8111-111111111111', { ...gate, priceEvidence: 'ALPACA_STOCK_BBO' }),
    /ORDER_EXECUTABLE_PRICE_PROVENANCE_MISMATCH/,
  );
  assert.equal(broker.submitCalls, 0);
});

test('a local write failure after broker acceptance remains restart-recoverable, never REJECTED', async () => {
  const broker = new MockBroker();
  class FailingAcknowledgementStore extends InMemoryPaperOrderStore {
    override async updateAttempt() { throw new Error('DATABASE_ACK_WRITE_FAILED'); }
  }
  const store = new FailingAcknowledgementStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator);
  await assert.rejects(coordinator.submit('11111111-1111-4111-8111-111111111111', gate), /DATABASE_ACK_WRITE_FAILED/);
  assert.equal(broker.submitCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'SUBMITTING');
});

test('cancel reconciles first and remains allowed for risk reduction when new entries are paused', async () => {
  const broker = new MockBroker(); broker.lookupResult = brokerOrder;
  const store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: true }));
  await prepare(coordinator);
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'READY', 'SUBMITTING');
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'SUBMITTING', 'ACKNOWLEDGED', brokerOrder.id);
  const result = await coordinator.cancel('11111111-1111-4111-8111-111111111111', {
    ...gate, isNewEntry: false, quoteFresh: false, aegisState: 'HOLD_ONLY', decisionExpiresAt: '2026-09-11T13:00:00Z',
  });
  assert.equal(result?.status, 'canceled');
  assert.equal(broker.cancelCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'CANCELED');
});

test('a fill observed before cancel prevents the cancel mutation', async () => {
  const broker = new MockBroker(); broker.lookupResult = { ...brokerOrder, filledQty: 1, status: 'filled' };
  const store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true }));
  await prepare(coordinator);
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'READY', 'SUBMITTING');
  const result = await coordinator.cancel('11111111-1111-4111-8111-111111111111', { ...gate, isNewEntry: false });
  assert.equal(result?.status, 'filled');
  assert.equal(broker.cancelCalls, 0);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'FILLED');
});

test('replace persists a distinct lineage intent and never increases working exposure', async () => {
  const broker = new MockBroker(); broker.lookupResult = brokerOrder;
  const store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator);
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'READY', 'SUBMITTING');
  await store.transitionIntent('11111111-1111-4111-8111-111111111111', 'SUBMITTING', 'ACKNOWLEDGED', brokerOrder.id);
  const replacement = {
    orderIntentId: '44444444-4444-4444-8444-444444444444', executionAccountId: '22222222-2222-4222-8222-222222222222',
    decisionId: '33333333-3333-4333-8333-333333333333', action: 'OPEN_CSP', persistedAt: gate.now,
    request: { ...order, limit_price: '1.20', client_order_id: 'theta-test-replace-2' }, ...executionLineage,
  };
  const result = await coordinator.replace('11111111-1111-4111-8111-111111111111', replacement, gate);
  assert.equal(result?.clientOrderId, 'theta-test-replace-2');
  assert.equal(broker.replaceCalls, 1); assert.equal(broker.submitCalls, 0);
  assert.equal((await store.getIntent(replacement.orderIntentId))?.status, 'ACKNOWLEDGED');
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'CANCELED');
  await assert.rejects(coordinator.replace(replacement.orderIntentId, {
    ...replacement, orderIntentId: '55555555-5555-4555-8555-555555555555', request: { ...replacement.request, qty: 2, client_order_id: 'theta-too-large' },
  }, gate), /MAY_NOT_INCREASE/);
});

test('replace cannot set total quantity equal to an already partial-filled quantity', async () => {
  const broker = new MockBroker(); broker.lookupResult = { ...brokerOrder, clientOrderId: 'theta-partial-original', qty: 2, filledQty: 1, status: 'partially_filled' };
  const store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await coordinator.prepare({
    orderIntentId: '66666666-6666-4666-8666-666666666666', executionAccountId: '22222222-2222-4222-8222-222222222222',
    request: { ...order, qty: 2, client_order_id: 'theta-partial-original' }, action: 'OPEN_CSP',
    decisionId: '33333333-3333-4333-8333-333333333333', persistedAt: gate.now, ...executionLineage,
  });
  await store.transitionIntent('66666666-6666-4666-8666-666666666666', 'READY', 'SUBMITTING');
  await assert.rejects(coordinator.replace('66666666-6666-4666-8666-666666666666', {
    orderIntentId: '77777777-7777-4777-8777-777777777777', executionAccountId: '22222222-2222-4222-8222-222222222222',
    request: { ...order, qty: 1, client_order_id: 'theta-partial-replace' }, action: 'OPEN_CSP',
    decisionId: '33333333-3333-4333-8333-333333333333', persistedAt: gate.now, ...executionLineage,
  }, gate), /MAY_NOT_INCREASE/);
  assert.equal(broker.replaceCalls, 0);
});

test('reconciliation rejects foreign broker identity malformed quantity and unknown status without changing local truth', async () => {
  for (const overrides of [{ clientOrderId: 'foreign' }, { symbol: 'OTHER' }, { side: 'buy' as const }, { qty: 2 },
    { positionIntent: 'buy_to_close' as const }, { filledQty: NaN }, { filledQty: 2 }, { status: 'filled', filledQty: 0 },
    { status: 'provider_new_unknown_state' }]) {
    const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
    const coordinator = new PaperOrderCoordinator(broker, store, control());
    const intent = await prepare(coordinator);
    await store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
    broker.lookupResult = { ...brokerOrder, ...overrides };
    await assert.rejects(coordinator.reconcileIntent(intent.orderIntentId), /BROKER_ORDER_(INTENT_IDENTITY_MISMATCH|QUANTITY_INVALID|STATUS_UNKNOWN)/);
    assert.equal((await store.getIntent(intent.orderIntentId))?.status, 'SUBMITTING');
    assert.equal(broker.submitCalls + broker.replaceCalls + broker.cancelCalls, 0);
  }
});

test('restart at every persisted order state reconciles active evidence or preserves non-submitted and terminal intent without mutation', async () => {
  for (const status of Object.keys(ORDER_INTENT_TRANSITIONS) as Array<keyof typeof ORDER_INTENT_TRANSITIONS>) {
    const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
    const coordinator = new PaperOrderCoordinator(broker, store, control());
    const intent = await prepare(coordinator);
    store.intents.set(intent.orderIntentId, { ...intent, status });
    const untouched = ['PROPOSED', 'PREFLIGHT', 'READY', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(status);
    broker.lookupResult = untouched ? null : { ...brokerOrder, status: 'filled', filledQty: 1 };
    await coordinator.recoverAfterRestart();
    // Resident PENDING_ORDER_MANAGEMENT also reads activeIntents and invokes
    // reconcileIntent, independently of interrupted-submit recovery.
    if (['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'CANCEL_REQUESTED'].includes(status)) await coordinator.reconcileIntent(intent.orderIntentId);
    assert.equal((await store.getIntent(intent.orderIntentId))?.status, untouched ? status : 'FILLED', status);
    assert.equal(broker.submitCalls + broker.replaceCalls + broker.cancelCalls, 0, status);
    assert.equal(store.attempts.size, 0, status);
  }
});

test('fast cancellation and pending cancellation can resolve an interrupted submission', async () => {
  for (const [brokerStatus, expected] of [['canceled', 'CANCELED'], ['expired', 'EXPIRED'], ['pending_cancel', 'CANCEL_REQUESTED']]) {
    const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
    const coordinator = new PaperOrderCoordinator(broker, store, control());
    const intent = await prepare(coordinator);
    await store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
    broker.lookupResult = { ...brokerOrder, status: brokerStatus as string };
    await coordinator.recoverAfterRestart();
    assert.equal((await store.getIntent(intent.orderIntentId))?.status, expected);
    assert.equal(broker.submitCalls, 0);
  }
});

test('nonfinite promoted EV and unsafe quantity never obtain broker authorization', async () => {
  for (const ev of [NaN, Infinity, -Infinity]) {
    const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
    const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
    const intent = await prepare(coordinator);
    store.intents.set(intent.orderIntentId, { ...intent, authorizationEvidence: { ...intent.authorizationEvidence,
      executionTier: 'EMPIRICALLY_PROMOTED_PAPER', empiricalEconomicsReady: true, expectedAfterCostEv: ev } });
    await assert.rejects(coordinator.submit(intent.orderIntentId, gate), /EMPIRICAL_PROMOTION_ECONOMICS_NOT_READY/);
    assert.equal(broker.submitCalls, 0);
  }
  const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  const intent = await prepare(coordinator);
  const qty = Number.MAX_SAFE_INTEGER + 1;
  store.intents.set(intent.orderIntentId, { ...intent, request: { ...intent.request, qty },
    authorizationEvidence: { ...intent.authorizationEvidence, canonicalQuantity: qty, paperEvidenceQuantity: qty } });
  await assert.rejects(coordinator.submit(intent.orderIntentId, gate), /PAPER_EVIDENCE_QUANTITY_INVALID/);
  assert.equal(broker.submitCalls, 0);
});

test('replacement of a working risk-opening order cannot bypass a new-entry pause or AEGIS veto', async () => {
  for (const paused of [true, false]) {
    const broker = new MockBroker(), store = new InMemoryPaperOrderStore();
    broker.lookupResult = brokerOrder;
    const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: paused }));
    const intent = await prepare(coordinator);
    await store.transitionIntent(intent.orderIntentId, 'READY', 'SUBMITTING');
    const replacement = { ...intent, orderIntentId: '44444444-4444-4444-8444-444444444444',
      request: { ...intent.request, client_order_id: 'replacement', limit_price: '1.20' } };
    await assert.rejects(coordinator.replace(intent.orderIntentId, replacement,
      { ...gate, isNewEntry: false, aegisState: paused ? 'ALLOW_FULL' : 'HARD_VETO' }), /NEW_ORDERS_PAUSED|AEGIS_NOT_APPROVED/);
    assert.equal(broker.replaceCalls, 0);
    assert.equal(broker.submitCalls, 0);
  }
});
