import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrokerOrder } from '../src/execution/broker.js';

// Production 2026-10-07: after the 069 cutover every broker/lifecycle cycle FAILED with ALPACA_ORDERS_MALFORMED_RESPONSE_HTTP_200. The Paper
// account holds two historical single-leg equity market orders that Alpaca returns with order_class "" and legs null; the multi-leg-aware
// parser accepted only "mleg", so reconciliation of status=all threw before any scan. Shapes below are the production ones (identifiers synthetic).
const simpleEquity = (patch: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', client_order_id: 'synthetic-client-1', created_at: '2026-09-11T15:38:33.781822Z',
  updated_at: '2026-09-11T15:38:34.000000Z', submitted_at: '2026-09-11T15:38:33.781822Z', filled_at: '2026-09-11T15:38:34.000000Z',
  expired_at: null, canceled_at: null, failed_at: null, replaced_at: null, replaced_by: null, replaces: null, asset_id: '00000000-0000-4000-8000-000000000002',
  symbol: 'QSI', asset_class: 'us_equity', notional: null, qty: '10', filled_qty: '10', filled_avg_price: '1.23', order_class: '', order_type: 'market',
  type: 'market', side: 'sell', position_intent: 'sell_to_close', time_in_force: 'day', limit_price: null, stop_price: null, status: 'filled',
  extended_hours: false, legs: null, trail_percent: null, trail_price: null, hwm: null, subtag: null, source: null, ...patch,
});

test('a single-leg order with order_class "" and legs null (the Alpaca simple-order shape) parses as a single-leg order', () => {
  const parsed = parseBrokerOrder(simpleEquity());
  assert.equal(parsed.symbol, 'QSI');
  assert.equal(parsed.side, 'sell');
  assert.equal(parsed.qty, 10);
  assert.equal(parsed.filledQty, 10);
  assert.equal(parsed.orderClass, null);
  assert.equal(parsed.legs, undefined);
  assert.equal(parseBrokerOrder(simpleEquity({ order_class: 'simple', side: 'buy', position_intent: 'buy_to_open' })).side, 'buy');
  assert.equal(parseBrokerOrder(simpleEquity({ order_class: null })).orderClass, null);
});

test('only mleg is a package; a non-THETA order class (bracket/oco/oto) still fails closed, never silently accepted', () => {
  for (const order_class of ['bracket', 'oco', 'oto']) assert.throws(() => parseBrokerOrder(simpleEquity({ order_class })));
  assert.throws(() => parseBrokerOrder(simpleEquity({ order_class: 'mleg' })), /multi-leg/, 'an mleg parent without legs is invalid');
});

test('a malformed order row is reported by endpoint, row index and schema path/code only, never by provider values, and reaches the cycle detail', async () => {
  const { AlpacaPaperBrokerAdapter } = await import('../src/execution/broker.js');
  const { safeRuntimeFailure } = await import('../src/theta/autonomous-runtime.js');
  const rows = [simpleEquity(), simpleEquity({ id: '00000000-0000-4000-8000-000000000009', symbol: 'SECRETSYM', order_class: 'bracket', status: 'new' })];
  const broker = new AlpacaPaperBrokerAdapter({ baseUrl: 'https://paper-api.alpaca.markets',
    authentication: { kind: 'MASTER_API_KEY', apiKey: 'k', apiSecret: 's' },
    fetchImpl: (async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch });
  const error = await broker.getOrders('all').then(() => null, (caught: unknown) => caught as Error);
  assert.ok(error);
  assert.match(error.message, /\/v2\/orders returned a malformed success payload \[shape: row\[1\] order_class:invalid_value\]/);
  assert.doesNotMatch(error.message, /SECRETSYM|00000000-0000-4000-8000-000000000009/);
  const failure = safeRuntimeFailure(error);
  assert.equal(failure.code, 'ALPACA_ORDERS_MALFORMED_RESPONSE_HTTP_200');
  assert.match(failure.detail, /Shape: row\[1\] order_class:invalid_value\./);
});

test('PARSER SHAPE AUDIT: a single-leg option order parses in every status Alpaca reports; an mleg parent parses with both legs', () => {
  const option = (patch: Record<string, unknown>) => simpleEquity({ symbol: 'TLT261113P00076000', asset_class: 'us_option', order_class: 'simple', type: 'limit',
    order_type: 'limit', side: 'sell', position_intent: 'sell_to_open', qty: '1', filled_qty: '0', filled_avg_price: null, limit_price: '1.80', ...patch });
  for (const status of ['new', 'accepted', 'pending_new', 'partially_filled', 'canceled', 'expired', 'rejected', 'pending_cancel', 'replaced', 'done_for_day']) {
    const parsed = parseBrokerOrder(option({ status, ...(status === 'partially_filled' ? { qty: '2', filled_qty: '1', filled_avg_price: '1.80' } : {}) }));
    assert.equal(parsed.status, status);
    assert.equal(parsed.orderClass, null);
  }
  assert.equal(parseBrokerOrder(option({ status: 'filled', filled_qty: '1', filled_avg_price: '1.80' })).filledQty, 1);
  const leg = (symbol: string, side: 'sell' | 'buy', intent: string) => ({ id: `leg-${symbol}`, symbol, side, position_intent: intent, ratio_qty: '1',
    qty: '1', filled_qty: '0', filled_avg_price: null, status: 'new', order_class: 'mleg', asset_class: 'us_option' });
  const mleg = parseBrokerOrder(simpleEquity({ symbol: '', asset_class: '', order_class: 'mleg', type: 'limit', side: null, position_intent: null, qty: '1',
    filled_qty: '0', filled_avg_price: null, limit_price: '-1.30', status: 'new',
    legs: [leg('TLT261113P00076000', 'sell', 'sell_to_open'), leg('TLT261113P00071000', 'buy', 'buy_to_open')] }));
  assert.equal(mleg.orderClass, 'mleg');
  assert.equal(mleg.legs?.length, 2);
  assert.equal(mleg.limitPrice, -1.3, 'an mleg credit is negative, never rejected as an invalid single-leg price');
});

test('a single-leg order with an empty or null symbol/side still fails closed (the mleg tolerance never weakens single-leg identity)', () => {
  assert.throws(() => parseBrokerOrder(simpleEquity({ symbol: '' })), /single-leg order without symbol or side/);
  assert.throws(() => parseBrokerOrder(simpleEquity({ side: null })), /single-leg order without symbol or side/);
  assert.throws(() => parseBrokerOrder(simpleEquity({ side: '' })), /single-leg order without symbol or side/);
});

test('a fully terminal bracket/OCO/OTO row in the account history never fails the order listing; a live one (or a filled parent with a working child) still fails closed', async () => {
  const { isTerminalNonThetaClassOrder } = await import('../src/execution/broker.js');
  for (const order_class of ['bracket', 'oco', 'oto']) {
    for (const status of ['filled', 'canceled', 'expired', 'rejected', 'replaced', 'done_for_day']) {
      assert.equal(isTerminalNonThetaClassOrder(simpleEquity({ order_class, status, legs: [{ status: 'canceled' }] })), true, `${order_class}/${status}`);
    }
    assert.equal(isTerminalNonThetaClassOrder(simpleEquity({ order_class, status: 'new' })), false, 'a working non-THETA class order is live unknown exposure');
    assert.equal(isTerminalNonThetaClassOrder(simpleEquity({ order_class, status: 'filled', legs: [{ status: 'new' }] })), false,
      'a filled parent with a working take-profit/stop child is still live');
  }
  for (const order_class of ['', 'simple', 'mleg', null]) assert.equal(isTerminalNonThetaClassOrder(simpleEquity({ order_class, status: 'filled' })), false,
    'THETA order classes are always parsed, never skipped');
});
