import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaPaperBrokerAdapter, AlpacaPaperBrokerError, parseBrokerActivity, parseBrokerOrder } from '../src/execution/broker.js';
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

test('exact option action payloads carry explicit position intent and never infer open/close from side', () => {
  const cases: Array<[ThetaOrderInstruction['action'], 'buy' | 'sell', string | undefined]> = [
    ['OPEN_CSP', 'sell', 'sell_to_open'], ['CLOSE_CSP', 'buy', 'buy_to_close'],
    ['ROLL_CSP_CLOSE', 'buy', 'buy_to_close'], ['ROLL_CSP_OPEN', 'sell', 'sell_to_open'],
    ['OPEN_CC', 'sell', 'sell_to_open'], ['CLOSE_CC', 'buy', 'buy_to_close'],
    ['ROLL_CC_CLOSE', 'buy', 'buy_to_close'], ['ROLL_CC_OPEN', 'sell', 'sell_to_open'],
    ['SELL_STOCK', 'sell', undefined],
  ];
  for (const [action, side, positionIntent] of cases) {
    const request = buildAlpacaLimitOrder({
      action, symbol: action === 'SELL_STOCK' ? 'AAPL' : 'AAPL261016P00150000', quantity: 1,
      limitPrice: 1.25, clientOrderId: `theta-${action.toLowerCase()}`,
      confirmedCoveredShares: action.includes('CC') ? 100 : undefined,
    });
    assert.deepEqual({ side: request.side, type: request.type, time: request.time_in_force, price: request.limit_price, qty: request.qty },
      { side, type: 'limit', time: 'day', price: '1.25', qty: 1 });
    assert.equal(request.position_intent, positionIntent);
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
  const permit = (clientOrderId: string, isNewEntry: boolean, operation: 'SUBMIT'|'REPLACE'|'CANCEL' = 'SUBMIT') => authorizeBrokerMutation(
    { masterEnabled: true, followerEnabled: false, pauseNewOrders: false },
    { accountKind: 'MASTER_API_KEY', environment: 'PAPER', baseHostname: 'paper-api.alpaca.markets', accountVerified: true,
      optionsCapabilityVerified: true, intentPersisted: true, aegisState: 'ALLOW_FULL', quantity: 1, quoteFresh: true,
      priceEvidence: 'ALPACA_OPRA_BBO',
      decisionExpiresAt: '2026-09-11T15:00:00Z', clientOrderId, now: '2026-09-11T14:00:00Z', isNewEntry, operation },
  );
  await assert.rejects(adapter.submitOrder(request, { authorizedAt: '2026-09-11T14:00:00Z', clientOrderId: request.client_order_id, quantity: 1 }), /valid execution-gate permit/);
  await adapter.submitOrder(request, permit('theta-client-1', true));
  await adapter.replaceOrder('broker-1', { qty: 1, limit_price: '1.20', time_in_force: 'day', client_order_id: 'theta-reprice-2' }, permit('theta-reprice-2', false, 'REPLACE'));
  await adapter.cancelOrder('broker-2', permit('theta-cancel-3', false, 'CANCEL'));
  assert.equal((await adapter.getOrderByClientOrderId('theta-client-1'))?.id, 'broker-1');
  assert.equal((await adapter.getOrder('broker-1'))?.id, 'broker-1');
  assert.equal((await adapter.getOrders()).length, 1);
  assert.equal((await adapter.getActivities()).at(0)?.activityType, 'OPASN');
  const activitiesUrl = calls.find((call) => call.url.includes('/activities'))?.url ?? '';
  assert.doesNotMatch(activitiesUrl, /activity_types=/);
  assert.match(activitiesUrl, /direction=asc/);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.method), ['POST', 'PATCH', 'DELETE']);
  assert.equal(calls[0]?.url, 'https://paper-api.alpaca.markets/v2/orders');
  assert.equal(calls[1]?.url, 'https://paper-api.alpaca.markets/v2/orders/broker-1');
  assert.equal(calls[0]?.body && (calls[0]?.body as Record<string, unknown>).type, 'limit');
});

test('broker order snapshots preserve real zero fills and reject missing or malformed numeric evidence', () => {
  assert.equal(parseBrokerOrder(rawOrder()).filledQty, 0);
  const missingFilled = rawOrder();
  delete (missingFilled as Record<string, unknown>).filled_qty;
  assert.throws(() => parseBrokerOrder(missingFilled));
  for (const filled_qty of ['', ' ', 'not-a-number', 'NaN', 'Infinity', '-1', '2']) {
    assert.throws(() => parseBrokerOrder(rawOrder({ filled_qty })));
  }
  for (const qty of ['', ' ', 'not-a-number', 'NaN', 'Infinity', '0', '-1']) {
    assert.throws(() => parseBrokerOrder(rawOrder({ qty })));
  }
  assert.throws(() => parseBrokerOrder(rawOrder({ filled_avg_price: '0' })), /filled average price/);
  assert.throws(() => parseBrokerOrder(rawOrder({ limit_price: '0' })), /limit price/);
  assert.throws(() => parseBrokerOrder(rawOrder({ submitted_at: 'not-a-time' })));
  for (const field of ['id', 'client_order_id', 'symbol', 'status'] as const) {
    assert.throws(() => parseBrokerOrder(rawOrder({ [field]: '   ' })));
  }
});

test('broker activities reject blank numeric evidence instead of coercing it to zero', () => {
  const activity = { id: 'activity-1', activity_type: 'FILL', symbol: 'AAPL', qty: '1', price: '2.50' };
  assert.deepEqual(
    { quantity: parseBrokerActivity(activity).quantity, price: parseBrokerActivity(activity).price },
    { quantity: 1, price: 2.5 },
  );
  for (const field of ['qty', 'price'] as const) {
    assert.throws(() => parseBrokerActivity({ ...activity, [field]: '' }));
    assert.throws(() => parseBrokerActivity({ ...activity, [field]: ' ' }));
    assert.throws(() => parseBrokerActivity({ ...activity, [field]: 'not-a-number' }));
  }
  assert.throws(() => parseBrokerActivity({ ...activity, transaction_time: 'not-a-time' }));
  assert.throws(() => parseBrokerActivity({ ...activity, date: '2026-02-30' }));
  assert.throws(() => parseBrokerActivity({ ...activity, id: '   ' }));
  assert.throws(() => parseBrokerActivity({ ...activity, symbol: '   ' }));
});

test('broker clock and calendar reject malformed time evidence before reconciliation', async () => {
  const config = (body: unknown) => new AlpacaPaperBrokerAdapter({
    baseUrl: 'https://paper-api.alpaca.markets',
    authentication: { kind: 'MASTER_API_KEY', apiKey: 'synthetic', apiSecret: 'synthetic' },
    fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
  });
  await assert.rejects(config({ timestamp: 'not-a-time', is_open: true }).getClock(), (error: unknown) =>
    error instanceof AlpacaPaperBrokerError && error.category === 'MALFORMED_RESPONSE');
  await assert.rejects(config([{ date: '2026-02-30', open: '09:30', close: '16:00' }])
    .getCalendar('2026-02-01', '2026-03-01'));
  await assert.rejects(config([{ date: '2026-09-11', open: '25:00', close: '16:00' }])
    .getCalendar('2026-09-11', '2026-09-11'));
  const valid = config({ timestamp: '2026-09-11T14:30:00.123456789Z', is_open: true,
    next_open: '2026-09-12T13:30:00Z', next_close: '2026-09-11T20:00:00Z' });
  assert.equal((await valid.getClock()).isOpen, true);
});

test('a mutation 5xx or malformed success body is ambiguous and must reconcile before retry', async () => {
  for (const response of [new Response('{}', { status: 503 }), new Response('not-json', { status: 200 }),
    new Response('{}', { status: 200 })]) {
    const adapter = new AlpacaPaperBrokerAdapter({ baseUrl: 'https://paper-api.alpaca.markets',
      authentication: { kind: 'MASTER_API_KEY', apiKey: 'synthetic', apiSecret: 'synthetic' },
      fetchImpl: async () => response.clone() });
    const request = buildAlpacaLimitOrder({ action: 'OPEN_CSP', symbol: 'AAPL261016P00150000', quantity: 1,
      limitPrice: 1.25, clientOrderId: 'theta-ambiguous' });
    const authorization = authorizeBrokerMutation({ masterEnabled: true, followerEnabled: false, pauseNewOrders: false }, {
      accountKind:'MASTER_API_KEY',environment:'PAPER',baseHostname:'paper-api.alpaca.markets',accountVerified:true,
      optionsCapabilityVerified:true,intentPersisted:true,aegisState:'ALLOW_FULL',quantity:1,quoteFresh:true,
      priceEvidence:'ALPACA_OPRA_BBO',decisionExpiresAt:'2026-09-11T15:00:00Z',clientOrderId:'theta-ambiguous',
      now:'2026-09-11T14:00:00Z',isNewEntry:true,operation:'SUBMIT' });
    await assert.rejects(adapter.submitOrder(request, authorization), (error: unknown) =>
      error instanceof AlpacaPaperBrokerError && error.category === 'AMBIGUOUS_NETWORK');
  }
});
