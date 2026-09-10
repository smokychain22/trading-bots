import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccountExposure, parseOccOptionSymbol } from '../src/theta/account-exposure.js';
import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot, MasterAccountSnapshot } from '../src/theta/alpaca-provider.js';

const NOW = '2026-09-10T15:00:00.000Z';

const account = (overrides: Partial<MasterAccountSnapshot> = {}): MasterAccountSnapshot => ({
  accountStatus: 'ACTIVE', equity: 100_000, cash: 50_000, buyingPower: 40_000, optionsBuyingPower: 20_000,
  optionsApprovedLevel: 2, optionsTradingLevel: 2, tradingBlocked: false, transfersBlocked: false,
  maskedAccountId: '****1234', receivedAt: NOW,
  ...overrides,
});

const position = (overrides: Partial<AlpacaPositionSnapshot> = {}): AlpacaPositionSnapshot => ({
  symbol: 'SPY', assetClass: 'us_equity', quantity: 10, side: 'long', avgEntryPrice: 500,
  marketValue: 5000, unrealizedPl: 100, receivedAt: NOW,
  ...overrides,
});

const openOrder = (overrides: Partial<AlpacaOpenOrderSnapshot> = {}): AlpacaOpenOrderSnapshot => ({
  orderId: 'order-1', clientOrderId: null, symbol: 'SPY', side: 'sell', quantity: 1, status: 'new',
  submittedAt: NOW, receivedAt: NOW,
  ...overrides,
});

test('parseOccOptionSymbol parses a standard OCC symbol exactly', () => {
  const parsed = parseOccOptionSymbol('SPY261009P00500000');
  assert.deepEqual(parsed, { underlying: 'SPY', expiration: '2026-10-09', optionType: 'PUT', strike: 500 });
});

test('parseOccOptionSymbol parses a call symbol and a non-round strike', () => {
  const parsed = parseOccOptionSymbol('AAPL270115C00187500');
  assert.deepEqual(parsed, { underlying: 'AAPL', expiration: '2027-01-15', optionType: 'CALL', strike: 187.5 });
});

test('parseOccOptionSymbol returns null (never a guess) for a non-matching symbol', () => {
  assert.equal(parseOccOptionSymbol('SPY'), null);
  assert.equal(parseOccOptionSymbol('NOT-A-SYMBOL'), null);
  assert.equal(parseOccOptionSymbol('SPY261009X00500000'), null); // invalid C/P
});

test('a short put position requires CSP collateral = strike * multiplier * |qty|', () => {
  const exposure = deriveAccountExposure(
    account(),
    [position({ symbol: 'SPY261009P00500000', assetClass: 'us_option', quantity: -2, side: 'short', marketValue: -200, unrealizedPl: 20 })],
    [],
  );
  assert.equal(exposure.cspCollateralRequired, 500 * 100 * 2);
  assert.equal(exposure.shortPutCount, 1);
  assert.equal(exposure.shortCallCount, 0);
});

test('a long put/call and short call are classified correctly and never counted as CSP collateral', () => {
  const exposure = deriveAccountExposure(
    account(),
    [
      position({ symbol: 'SPY261009C00520000', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -50, unrealizedPl: 5 }),
      position({ symbol: 'SPY261009P00480000', assetClass: 'us_option', quantity: 1, side: 'long', marketValue: 40, unrealizedPl: -2 }),
      position({ symbol: 'SPY261009C00520000', assetClass: 'us_option', quantity: 1, side: 'long', marketValue: 60, unrealizedPl: 3 }),
    ],
    [],
  );
  assert.equal(exposure.shortCallCount, 1);
  assert.equal(exposure.longPutCount, 1);
  assert.equal(exposure.longCallCount, 1);
  assert.equal(exposure.cspCollateralRequired, 0);
});

test('stock inventory value sums real marketValue across us_equity positions, distinct from option exposure', () => {
  const exposure = deriveAccountExposure(
    account(),
    [position({ symbol: 'SPY', assetClass: 'us_equity', quantity: 10, marketValue: 5000 }), position({ symbol: 'AAPL', assetClass: 'us_equity', quantity: 5, marketValue: 1000 })],
    [],
  );
  assert.equal(exposure.stockInventoryValue, 6000);
});

test('an unparsed option symbol makes CSP collateral UNKNOWN (null), never a silent partial sum', () => {
  const exposure = deriveAccountExposure(
    account(),
    [
      position({ symbol: 'SPY261009P00500000', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -100 }),
      position({ symbol: 'UNRECOGNIZED-SYMBOL', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -50 }),
    ],
    [],
  );
  assert.equal(exposure.cspCollateralRequired, null);
  assert.deepEqual(exposure.unparsedOptionSymbols, ['UNRECOGNIZED-SYMBOL']);
});

test('a missing stock marketValue makes stockInventoryValue UNKNOWN (null), never coerced to a partial number', () => {
  const exposure = deriveAccountExposure(
    account(),
    [position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 5000 }), position({ symbol: 'AAPL', assetClass: 'us_equity', marketValue: null })],
    [],
  );
  assert.equal(exposure.stockInventoryValue, null);
});

test('portfolioCapitalAtRiskPct and tickerConcentrationPct are real ratios against equity', () => {
  const exposure = deriveAccountExposure(
    account({ equity: 100_000 }),
    [
      position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 10_000 }),
      position({ symbol: 'SPY261009P00500000', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -100 }),
    ],
    [],
  );
  // stock 10,000 + CSP collateral 500*100*1=50,000 => 60,000 / 100,000 = 0.6
  assert.equal(exposure.portfolioCapitalAtRiskPct, 0.6);
  assert.equal(exposure.tickerConcentrationPct, 0.6);
  assert.equal(exposure.largestConcentrationUnderlying, 'SPY');
});

test('null equity makes every derived ratio UNKNOWN, never a division against zero or a fabricated default', () => {
  const exposure = deriveAccountExposure(
    account({ equity: null }),
    [position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 10_000 })],
    [],
  );
  assert.equal(exposure.portfolioCapitalAtRiskPct, null);
  assert.equal(exposure.tickerConcentrationPct, null);
});

test('a null account snapshot leaves account-level fields UNKNOWN but still counts positions/orders', () => {
  const exposure = deriveAccountExposure(null, [position({ assetClass: 'us_equity', marketValue: 1000 })], [openOrder()]);
  assert.equal(exposure.equity, null);
  assert.equal(exposure.cash, null);
  assert.equal(exposure.stockInventoryValue, 1000);
  assert.equal(exposure.openOrderCount, 1);
});

test('an unrecognized assetClass is neither stock nor option exposure -- never guessed into either bucket', () => {
  const exposure = deriveAccountExposure(account(), [position({ symbol: 'CRYPTO', assetClass: 'crypto', marketValue: 500 })], []);
  assert.equal(exposure.stockInventoryValue, 0);
  assert.equal(exposure.shortPutCount + exposure.shortCallCount + exposure.longPutCount + exposure.longCallCount, 0);
});

test('a genuinely empty account (no positions, no orders) is a real zero exposure, not UNKNOWN', () => {
  const exposure = deriveAccountExposure(account(), [], []);
  assert.equal(exposure.stockInventoryValue, 0);
  assert.equal(exposure.cspCollateralRequired, 0);
  assert.equal(exposure.portfolioCapitalAtRiskPct, 0);
  assert.equal(exposure.openOrderCount, 0);
});
