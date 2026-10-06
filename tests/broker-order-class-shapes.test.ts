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
