import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerAdapter } from '../src/execution/broker.js';
import { assertRollPair, buildAlpacaLimitOrder, type ThetaOrderInstruction } from '../src/execution/order-construction.js';
import { authorizeBrokerMutation } from '../src/execution/execution-control.js';

const rawOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'broker-1', client_order_id: 'theta-client-1', symbol: 'AAPL261016P00150000', qty: '1', filled_qty: '0',
  filled_avg_price: null, side: 'sell', status: 'accepted', limit_price: '1.25', submitted_at: '2026-09-11T14:30:00Z',
  replaced_by: null, replaces: null, ...overrides,
});

test('master and follower adapters share the same PAPER-only implementation and reject LIVE', () => {
  assert.throws(() => new AlpacaPaperBrokerAdapter({
    baseUrl: 'https://api.alpaca.markets', authentication: { kind: 'MASTER_API_KEY', apiKey: 'x', apiSecret: 'y' },
  }), /PAPER/);
  const follower = new AlpacaPaperBrokerAdapter({
    baseUrl: 'https://paper-api.alpaca.markets', authentication: { kind: 'FOLLOWER_OAUTH', accessToken: 'private-test-token' },
  });
  assert.equal(follower.accountKind, 'FOLLOWER_OAUTH');
  assert.equal(follower.environment, 'PAPER');
});

test('exact option action payloads are limit DAY orders with deterministic caller identity', () => {
  const cases: Array<[ThetaOrderInstruction['action'], 'buy' | 'sell']> = [
    ['OPEN_CSP', 'sell'], ['CLOSE_CSP', 'buy'], ['ROLL_CSP_CLOSE', 'buy'], ['ROLL_CSP_OPEN', 'sell'],
    ['OPEN_CC', 'sell'], ['CLOSE_CC', 'buy'], ['ROLL_CC_CLOSE', 'buy'], ['ROLL_CC_OPEN', 'sell'], ['SELL_STOCK', 'sell'],
  ];
  for (const [action, side] of cases) {
    const request = buildAlpacaLimitOrder({
      action, symbol: action === 'SELL_STOCK' ? 'AAPL' : 'AAPL261016P00150000', quantity: 1,
      limitPrice: 1.25, clientOrderId: `theta-${action.toLowerCase()}`,
      confirmedCoveredShares: action.includes('CC') ? 100 : undefined,
    });
    assert.deepEqual({ side: request.side, type: request.type, time: request.time_in_force, price: request.limit_price, qty: request.qty },
      { side, type: 'limit', time: 'day', price: '1.25', qty: 1 });
  }
});

test('covered-call construction fails without confirmed shares and roll legs remain separate', () => {
  assert.throws(() => buildAlpacaLimitOrder({ action: 'OPEN_CC', symbol: 'AAPL261016C00180000', quantity: 1, limitPrice: 1, clientOrderId: 'cc' }), /coverage/);
  const close: ThetaOrderInstruction = { action: 'ROLL_CSP_CLOSE', symbol: 'OLD', quantity: 1, limitPrice: 2, clientOrderId: 'close' };
  const open: ThetaOrderInstruction = { action: 'ROLL_CSP_OPEN', symbol: 'NEW', quantity: 1, limitPrice: 3, clientOrderId: 'open' };
  assert.doesNotThrow(() => assertRollPair(close, open));
  assert.throws(() => assertRollPair(close, { ...open, clientOrderId: 'close' }), /own client_order_id/);
});

test('submit, replace, cancel, retrieve, and activities use documented paths without leaking auth into results', async () => {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (url.includes('/activities')) return new Response(JSON.stringify([{ id: 'activity-1', activity_type: 'OPASN', symbol: 'AAPL261016P00150000', qty: '1', date: '2026-10-16' }]), { status: 200 });
    if (url.includes('by_client_order_id')) return new Response(JSON.stringify(rawOrder()), { status: 200 });
    if (url.includes('/v2/orders?')) return new Response(JSON.stringify([rawOrder()]), { status: 200 });
    return new Response(JSON.stringify(rawOrder({ status: method === 'PATCH' ? 'replaced' : 'accepted' })), { status: 200 });
  };
  const adapter = new AlpacaPaperBrokerAdapter({
    baseUrl: 'https://paper-api.alpaca.markets', authentication: { kind: 'MASTER_API_KEY', apiKey: 'test-key-private', apiSecret: 'test-secret-private' }, fetchImpl,
  });
  const request = buildAlpacaLimitOrder({ action: 'OPEN_CSP', symbol: 'AAPL261016P00150000', quantity: 1, limitPrice: 1.25, clientOrderId: 'theta-client-1' });
  const permit = (clientOrderId: string, isNewEntry: boolean) => authorizeBrokerMutation(
    { masterEnabled: true, followerEnabled: false, pauseNewOrders: false },
    { accountKind: 'MASTER_API_KEY', environment: 'PAPER', baseHostname: 'paper-api.alpaca.markets', accountVerified: true,
      optionsCapabilityVerified: true, intentPersisted: true, aegisState: 'ALLOW_FULL', quantity: 1, quoteFresh: true,
      decisionExpiresAt: '2026-09-11T15:00:00Z', clientOrderId, now: '2026-09-11T14:00:00Z', isNewEntry },
  );
  await assert.rejects(adapter.submitOrder(request, { authorizedAt: '2026-09-11T14:00:00Z', clientOrderId: request.client_order_id, quantity: 1 }), /valid execution-gate permit/);
  await adapter.submitOrder(request, permit('theta-client-1', true));
  await adapter.replaceOrder('broker-1', { qty: 1, limit_price: '1.20', time_in_force: 'day', client_order_id: 'theta-reprice-2' }, permit('theta-reprice-2', false));
  await adapter.cancelOrder('broker-2', permit('theta-cancel-3', false));
  assert.equal((await adapter.getOrderByClientOrderId('theta-client-1'))?.id, 'broker-1');
  assert.equal((await adapter.getOrders()).length, 1);
  assert.equal((await adapter.getActivities()).at(0)?.activityType, 'OPASN');
  assert.deepEqual(calls.slice(0, 3).map((call) => call.method), ['POST', 'PATCH', 'DELETE']);
  assert.equal(calls[0]?.url, 'https://paper-api.alpaca.markets/v2/orders');
  assert.equal(calls[1]?.url, 'https://paper-api.alpaca.markets/v2/orders/broker-1');
  assert.equal(calls[0]?.body && (calls[0]?.body as Record<string, unknown>).type, 'limit');
});
