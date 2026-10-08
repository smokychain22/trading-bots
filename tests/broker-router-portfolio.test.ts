import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveBrokerRouterPortfolio } from '../src/theta/broker-router-portfolio.js';
import type { AlpacaPositionSnapshot, AlpacaOpenOrderSnapshot } from '../src/theta/alpaca-provider.js';
const observedAt = '2026-09-30T15:00:00Z';
const base = { underlying: 'SPY', positions: [], orders: [], positionsReady: true, ordersReady: true, accountReady: true, observedAt };
const position = (changes: Partial<AlpacaPositionSnapshot> = {}): AlpacaPositionSnapshot => ({
  symbol: 'SPY', assetClass: 'us_equity', quantity: 100, side: 'long', avgEntryPrice: 500,
  marketValue: 50_000, unrealizedPl: 0, receivedAt: observedAt, ...changes,
});
test('complete empty reads prove flat state, failed reads never do', () => {
  const flat = deriveBrokerRouterPortfolio(base);
  assert.deepEqual(flat.portfolio, { lifecycleState: 'CASH_AVAILABLE', stockSharesHeld: 0, openOptionExists: false, assignmentImminent: false });
  assert.equal(flat.origin, 'DERIVED_FROM_REAL');
  for (const field of ['accountReady', 'positionsReady', 'ordersReady']) {
    const result = deriveBrokerRouterPortfolio({ ...base, [field]: false });
    assert.equal(result.portfolio.lifecycleState, 'UNKNOWN');
    assert.equal(result.portfolio.stockSharesHeld, null);
    assert.equal(result.origin, 'REAL_PROVIDER_UNKNOWN');
  }
});
test('stock and pending orders change applicability without inventing assignment', () => {
  assert.equal(deriveBrokerRouterPortfolio({ ...base, positions: [position()] }).portfolio.lifecycleState, 'STOCK_HELD');
  const order = { symbol: 'SPY261016P00500000' } as AlpacaOpenOrderSnapshot;
  assert.equal(deriveBrokerRouterPortfolio({ ...base, orders: [order] }).portfolio.lifecycleState, 'ORDER_PENDING');
  assert.equal(deriveBrokerRouterPortfolio({ ...base, positions: [position({ symbol: 'QQQ' })] }).portfolio.lifecycleState, 'CASH_AVAILABLE');
});
test('short put exposure is real but assignment imminence is not inferred', () => {
  const result = deriveBrokerRouterPortfolio({ ...base, positions: [position({ symbol: 'SPY261016P00500000', assetClass: 'us_option', side: 'short', quantity: -1 })] });
  assert.equal(result.portfolio.lifecycleState, 'CSP_OPEN');
  assert.equal(result.portfolio.openOptionExists, true);
  assert.equal(result.portfolio.assignmentImminent, null);
  assert.equal(result.origin, 'REAL_PROVIDER_UNKNOWN');
});
test('unclassified identity and missing quantity cannot become flat', () => {
  for (const item of [position({ quantity: null }), position({ assetClass: null }),
    position({ symbol: 'broken', assetClass: 'us_option' }), position({ side: 'short', quantity: -100 })]) {
    assert.equal(deriveBrokerRouterPortfolio({ ...base, positions: [item] }).portfolio.lifecycleState, 'UNKNOWN');
  }
});

test('known option exposure permits evaluation without claiming coverage or a management chain', () => {
  const positions = [position({ symbol: 'SPY261016C00500000', assetClass: 'us_option', side: 'short', quantity: -1 })];
  const result = deriveBrokerRouterPortfolio({ ...base, positions });
  assert.equal(result.portfolio.lifecycleState, 'EXPOSURE_PRESENT');
  assert.equal(result.portfolio.openOptionExists, true);
  assert.equal(result.portfolio.stockSharesHeld, 0);
  assert.equal(result.portfolio.assignmentImminent, null);
  assert.equal(deriveBrokerRouterPortfolio({ ...base, positions,
    orders: [{ symbol: positions[0]?.symbol } as AlpacaOpenOrderSnapshot] }).portfolio.lifecycleState, 'ORDER_PENDING');
});

test('unparseable or adjusted open orders cannot prove absence of pending SPY exposure', () => {
  for (const symbol of [null, '', 'SPY1261016P00500000', 'broken', 'SPY261016Pbad', 'BTC/USD']) {
    const result = deriveBrokerRouterPortfolio({ ...base, orders: [{ symbol } as AlpacaOpenOrderSnapshot] });
    assert.equal(result.portfolio.lifecycleState, 'UNKNOWN');
    assert.equal(result.reason, 'BROKER_ORDER_IDENTITY_UNKNOWN');
  }
  for (const symbol of ['QQQ', 'BRK.B', 'QQQ261016P00500000']) {
    assert.equal(deriveBrokerRouterPortfolio({ ...base, orders: [{ symbol } as AlpacaOpenOrderSnapshot] })
      .portfolio.lifecycleState, 'CASH_AVAILABLE');
  }
});
