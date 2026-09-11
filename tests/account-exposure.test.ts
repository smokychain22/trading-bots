import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAccountExposure, mergeDerivedExposureIntoAegisInputs, parseOccOptionSymbol } from '../src/theta/account-exposure.js';
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
  orderId: 'order-1', clientOrderId: null, symbol: 'SPY', assetClass: 'us_equity', side: 'sell', quantity: 1,
  filledQuantity: 0, orderType: 'limit', limitPrice: null, stopPrice: null, status: 'new',
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

// --- mergeDerivedExposureIntoAegisInputs ---

test('when trustworthy, real derived ticker concentration overwrites the caller-manual value', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 40_000 })], []);
  const merged = mergeDerivedExposureIntoAegisInputs({ tickerConcentrationPct: 0.05, sectorConcentrationPct: 0.1 }, exposure, true);
  assert.equal(merged.tickerConcentrationPct, 0.4);
  // Fields with no real derivation source are passed through unchanged.
  assert.equal(merged.sectorConcentrationPct, 0.1);
});

test('when NOT trustworthy (a required fetch failed this cycle), the caller-manual value is preserved, never overwritten with a possibly-wrong derivation', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 40_000 })], []);
  const merged = mergeDerivedExposureIntoAegisInputs({ tickerConcentrationPct: 0.05 }, exposure, false);
  assert.equal(merged.tickerConcentrationPct, 0.05);
});

test('a derived ratio that is itself UNKNOWN (null) never overwrites the caller-manual value with a fabricated 0', () => {
  const exposure = deriveAccountExposure(account({ equity: null }), [position({ symbol: 'SPY', assetClass: 'us_equity', marketValue: 40_000 })], []);
  assert.equal(exposure.tickerConcentrationPct, null);
  const merged = mergeDerivedExposureIntoAegisInputs({ tickerConcentrationPct: 0.05 }, exposure, true);
  assert.equal(merged.tickerConcentrationPct, 0.05);
});

// --- pendingOrderCapital (item F) ---

test('a sell-to-open short put order (no matching long position) commits real strike-based collateral', () => {
  const exposure = deriveAccountExposure(
    account(),
    [],
    [openOrder({ symbol: 'SPY261009P00500000', assetClass: 'us_option', side: 'sell', quantity: 2, filledQuantity: 0 })],
  );
  assert.equal(exposure.pendingOrderCapital, 500 * 100 * 2);
});

test('a sell order that matches an existing long position in the same exact contract is a closing sale -- no new collateral', () => {
  const exposure = deriveAccountExposure(
    account(),
    [position({ symbol: 'SPY261009P00500000', assetClass: 'us_option', side: 'long', quantity: 2 })],
    [openOrder({ symbol: 'SPY261009P00500000', assetClass: 'us_option', side: 'sell', quantity: 2, filledQuantity: 0 })],
  );
  assert.equal(exposure.pendingOrderCapital, 0);
});

test('a stock buy order with a known limit price commits limitPrice * remainingQty', () => {
  const exposure = deriveAccountExposure(
    account(),
    [],
    [openOrder({ symbol: 'AAPL', assetClass: 'us_equity', side: 'buy', quantity: 10, filledQuantity: 4, limitPrice: 150 })],
  );
  assert.equal(exposure.pendingOrderCapital, 150 * 6);
});

test('a stock buy order with NO limit price (e.g. a market order) makes pendingOrderCapital UNKNOWN, never a guessed fill price', () => {
  const exposure = deriveAccountExposure(account(), [], [openOrder({ symbol: 'AAPL', assetClass: 'us_equity', side: 'buy', quantity: 10, limitPrice: null })]);
  assert.equal(exposure.pendingOrderCapital, null);
});

test('a stock sell order and an option buy order never add to pendingOrderCapital -- both are closing/reducing or ambiguous, never guessed', () => {
  const exposure = deriveAccountExposure(
    account(),
    [],
    [
      openOrder({ symbol: 'AAPL', assetClass: 'us_equity', side: 'sell', quantity: 5 }),
      openOrder({ symbol: 'SPY261009P00500000', assetClass: 'us_option', side: 'buy', quantity: 1 }),
    ],
  );
  assert.equal(exposure.pendingOrderCapital, 0);
});

test('a fully-filled order (remainingQty=0) contributes nothing further', () => {
  const exposure = deriveAccountExposure(
    account(),
    [],
    [openOrder({ symbol: 'SPY261009P00500000', assetClass: 'us_option', side: 'sell', quantity: 2, filledQuantity: 2 })],
  );
  assert.equal(exposure.pendingOrderCapital, 0);
});

test('no open orders is a real zero pendingOrderCapital, not UNKNOWN', () => {
  const exposure = deriveAccountExposure(account(), [], []);
  assert.equal(exposure.pendingOrderCapital, 0);
});

test('an UNKNOWN pendingOrderCapital poisons portfolioCapitalAtRiskPct too -- never silently excluded from capital-at-risk', () => {
  const exposure = deriveAccountExposure(
    account({ equity: 100_000 }),
    [],
    [openOrder({ symbol: 'AAPL', assetClass: 'us_equity', side: 'buy', quantity: 10, limitPrice: null })],
  );
  assert.equal(exposure.pendingOrderCapital, null);
  assert.equal(exposure.portfolioCapitalAtRiskPct, null);
});

test('a real, known pendingOrderCapital is included in portfolioCapitalAtRiskPct', () => {
  const exposure = deriveAccountExposure(
    account({ equity: 100_000 }),
    [],
    [openOrder({ symbol: 'AAPL', assetClass: 'us_equity', side: 'buy', quantity: 10, limitPrice: 200 })],
  );
  assert.equal(exposure.pendingOrderCapital, 2000);
  assert.equal(exposure.portfolioCapitalAtRiskPct, 0.02);
});
