import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerError, type BrokerOrderRequest, type BrokerOrderSnapshot, type PaperBrokerAdapter } from '../src/execution/broker.js';
import { executionMode, type ExecutionGateContext, type PaperExecutionControl } from '../src/execution/execution-control.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';

const order: BrokerOrderRequest = { symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: '1.25', client_order_id: 'theta-test-1' };
const brokerOrder: BrokerOrderSnapshot = { id: 'broker-1', clientOrderId: order.client_order_id, symbol: order.symbol, qty: 1, filledQty: 0, filledAvgPrice: null, side: 'sell', status: 'accepted', limitPrice: 1.25, submittedAt: '2026-09-11T14:30:00Z', replacedBy: null, replaces: null };

class MockBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const;
  readonly environment = 'PAPER' as const;
  submitCalls = 0;
  lookupCalls = 0;
  submitError: Error | null = null;
  lookupResult: BrokerOrderSnapshot | null = null;
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => [];
  getActivities = async () => []; replaceOrder = async () => brokerOrder; cancelOrder = async () => {};
  getOrderByClientOrderId = async () => { this.lookupCalls += 1; return this.lookupResult; };
  submitOrder = async () => { this.submitCalls += 1; if (this.submitError) throw this.submitError; return brokerOrder; };
}

const control = (overrides: Partial<PaperExecutionControl> = {}): PaperExecutionControl => ({ masterEnabled: false, followerEnabled: false, pauseNewOrders: true, ...overrides });
const gate: Omit<ExecutionGateContext, 'intentPersisted' | 'accountKind' | 'environment' | 'clientOrderId' | 'quantity'> = {
  baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true,
  aegisState: 'ALLOW_FULL', quoteFresh: true, decisionExpiresAt: '2026-09-11T15:00:00Z', now: '2026-09-11T14:00:00Z', isNewEntry: true,
};
const prepare = async (coordinator: PaperOrderCoordinator) => coordinator.prepare({ orderIntentId: '11111111-1111-4111-8111-111111111111', executionAccountId: '22222222-2222-4222-8222-222222222222', request: order, action: 'OPEN_CSP', decisionId: '33333333-3333-4333-8333-333333333333', persistedAt: gate.now });

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
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'SUBMITTED');
  assert.equal(store.attempts.size, 1);
});

test('ambiguous submission reconciles by client_order_id and never retries submit', async () => {
  const broker = new MockBroker(); broker.submitError = new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, 'timeout'); broker.lookupResult = brokerOrder;
  const store = new InMemoryPaperOrderStore(); const coordinator = new PaperOrderCoordinator(broker, store, control({ masterEnabled: true, pauseNewOrders: false }));
  await prepare(coordinator); const result = await coordinator.submit('11111111-1111-4111-8111-111111111111', gate);
  assert.equal(result?.id, 'broker-1'); assert.equal(broker.submitCalls, 1); assert.equal(broker.lookupCalls, 1);
  assert.equal((await store.getIntent('11111111-1111-4111-8111-111111111111'))?.status, 'SUBMITTED');
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
