import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from '../src/execution/broker.js';
import { MasterPaperExecutionOrchestrator, type MasterPaperExecutionCommand } from '../src/execution/master-paper-execution-orchestrator.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator } from '../src/execution/paper-order-coordinator.js';

const now = '2026-09-14T14:00:00.000Z';
const ids = { account: '22222222-2222-4222-8222-222222222222', decision: '33333333-3333-4333-8333-333333333333' };
const snapshot = (request: BrokerOrderRequest, status = 'accepted', filledQty = 0): BrokerOrderSnapshot => ({
  id: `broker-${request.client_order_id}`, clientOrderId: request.client_order_id, symbol: request.symbol,
  qty: request.qty, filledQty, filledAvgPrice: filledQty > 0 ? Number(request.limit_price) : null,
  side: request.side, status, limitPrice: Number(request.limit_price), submittedAt: now, replacedBy: null, replaces: null,
});

class StatefulBroker implements PaperBrokerAdapter {
  readonly accountKind = 'MASTER_API_KEY' as const; readonly environment = 'PAPER' as const;
  readonly orders = new Map<string, BrokerOrderSnapshot>(); submitCalls = 0;
  getAccount = async () => ({}); getPositions = async () => []; getOrders = async () => [...this.orders.values()];
  getActivities = async () => []; replaceOrder = async () => { throw new Error('not used'); }; cancelOrder = async () => {};
  getOrderByClientOrderId = async (clientOrderId: string) => this.orders.get(clientOrderId) ?? null;
  getOrder = async (providerOrderId: string) => [...this.orders.values()].find((order) => order.id === providerOrderId) ?? null;
  submitOrder = async (request: BrokerOrderRequest) => { this.submitCalls += 1; const order = snapshot(request); this.orders.set(request.client_order_id, order); return order; };
}

const command = (overrides: Partial<MasterPaperExecutionCommand> = {}): MasterPaperExecutionCommand => ({
  orderIntentId: '11111111-1111-4111-8111-111111111111', executionAccountId: ids.account,
  decisionId: ids.decision, action: 'OPEN_CSP', persistedAt: now,
  chainId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',optionContractId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  underlyingId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',executionEvidence:{quoteSource:'ALPACA',quoteFeed:'OPRA',
    quoteAsOf:now,decisionExpiresAt:'2026-09-14T14:01:00.000Z',quoteContentHash:'a'.repeat(64),aegisState:'ALLOW_FULL'},
  request: { symbol: 'AAPL261016P00150000', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day',
    limit_price: '1.25', client_order_id: 'theta-open-1', position_intent: 'sell_to_open' },
  gate: { baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true,
    aegisState: 'ALLOW_FULL', quoteFresh: true, priceEvidence: 'ALPACA_OPRA_BBO',
    decisionExpiresAt: '2026-09-14T14:01:00.000Z', now, isNewEntry: true },
  ...overrides,
});

const setup = () => {
  const broker = new StatefulBroker(), store = new InMemoryPaperOrderStore();
  const coordinator = new PaperOrderCoordinator(broker, store, { masterEnabled: true, followerEnabled: false, pauseNewOrders: false });
  return { broker, store, coordinator, runtime: new MasterPaperExecutionOrchestrator(coordinator) };
};

test('replaying the same approved command reconciles by client_order_id and submits once', async () => {
  const { broker, runtime } = setup();
  assert.equal((await runtime.execute(command())).submittedNow, true);
  assert.equal((await runtime.execute(command())).submittedNow, false);
  assert.equal(broker.submitCalls, 1);
});

test('an unresolved prior submission blocks a different new order', async () => {
  const { runtime, store } = setup();
  const unresolved = command();
  await store.insertIntent({ ...unresolved, status: 'UNKNOWN_SUBMISSION', brokerOrderId: null });
  const next = command({ orderIntentId: '44444444-4444-4444-8444-444444444444',
    request: { ...unresolved.request, client_order_id: 'theta-open-2' } });
  assert.equal((await runtime.execute(next)).state, 'BLOCKED_UNRESOLVED_ORDER');
});

test('roll never opens the new leg until the old leg is broker-confirmed filled', async () => {
  const { broker, runtime } = setup();
  const close = command({ action: 'ROLL_CSP_CLOSE', gate: { ...command().gate, isNewEntry: false },
    request: { ...command().request, side: 'buy', position_intent: 'buy_to_close', client_order_id: 'theta-roll-close' } });
  const open = command({ orderIntentId: '55555555-5555-4555-8555-555555555555', action: 'ROLL_CSP_OPEN',
    request: { ...command().request, symbol: 'AAPL261120P00145000', client_order_id: 'theta-roll-open' } });
  const first = await runtime.executeRoll(close, open);
  assert.equal(first.state, 'CLOSE_WORKING'); assert.equal(broker.submitCalls, 1);
  broker.orders.set(close.request.client_order_id, snapshot(close.request, 'filled', 1));
  const second = await runtime.executeRoll(close, open);
  assert.equal(second.state, 'OPEN_WORKING'); assert.equal(broker.submitCalls, 2);
});

test('a risk-reducing CSP close can submit while new entries are paused and AEGIS is HOLD_ONLY', async () => {
  const broker = new StatefulBroker(), store = new InMemoryPaperOrderStore();
  const runtime = new MasterPaperExecutionOrchestrator(new PaperOrderCoordinator(broker, store,
    { masterEnabled: true, followerEnabled: false, pauseNewOrders: true }));
  const close = command({ action: 'CLOSE_CSP', gate: { ...command().gate, isNewEntry: false, aegisState: 'HOLD_ONLY' },
    request: { ...command().request, side: 'buy', position_intent: 'buy_to_close', client_order_id: 'theta-close-1' } });
  assert.equal((await runtime.execute(close)).submittedNow, true);
});
