import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveAccountExposure,
  deriveCandidateCapacityAssessment,
  deriveCandidateInclusiveAegisInputs,
  deriveRecoveryInventoryValue,
  mergeDerivedExposureIntoAegisInputs,
  parseOccOptionSymbol,
} from '../src/theta/account-exposure.js';
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
  positionIntent: null, limitPrice: null, submittedAt: NOW, receivedAt: NOW,
  ...overrides,
});

test('parseOccOptionSymbol parses a standard OCC symbol exactly', () => {
  const parsed = parseOccOptionSymbol('SPY261009P00500000');
  assert.deepEqual(parsed, { underlying: 'SPY', expiration: '2026-10-09', optionType: 'PUT', strike: 500 });
});

test('unclassifiable position quantity or asset never becomes zero portfolio exposure', () => {
  for (const invalid of [null, NaN, Infinity, 0, 0.5]) {
    const exposure = deriveAccountExposure(account(), [position({ assetClass: 'us_option',
      symbol: 'SPY261009P00500000', quantity: invalid, side: 'short' })], []);
    assert.equal(exposure.cspCollateralRequired, null);
    assert.equal(exposure.tickerConcentrationPct, null);
    assert.equal(exposure.portfolioCapitalAtRiskPct, null);
    assert.deepEqual(exposure.unclassifiedPositionSymbols, ['SPY261009P00500000']);
    assert.equal(deriveCandidateInclusiveAegisInputs(exposure, [], { underlying: 'SPY',
      securedCollateralPerContract: 50_000, quantity: 1 }, 0).tickerConcentrationPct, null);
  }
  for (const p of [position({ assetClass: 'crypto' }), position({ marketValue: NaN }),
    position({ marketValue: -5000, side: 'short' })]) {
    const exposure = deriveAccountExposure(account(), [p], []);
    assert.equal(exposure.portfolioCapitalAtRiskPct, null);
    assert.equal(exposure.tickerConcentrationPct, null);
  }
});

test('long option marks count as current capital at risk without inventing a short-leg hedge offset', () => {
  const exposure = deriveAccountExposure(account(), [position({ assetClass: 'us_option',
    symbol: 'SPY261009P00500000', quantity: 1, marketValue: 1200, side: 'long' })], []);
  assert.equal(exposure.longOptionValue, 1200);
  assert.equal(exposure.cspCollateralRequired, 0);
  assert.equal(exposure.portfolioCapitalAtRiskPct, 0.012);
  assert.equal(exposure.tickerConcentrationPct, 0.012);
  const proposed = deriveCandidateInclusiveAegisInputs(exposure, [], { underlying: 'SPY', securedCollateralPerContract: 50_000, quantity: 1 }, 0);
  assert.equal(proposed.portfolioCapitalAtRiskPct, 0.512);
});

test('uncovered short calls cannot masquerade as an empty portfolio and covered shares are counted only once', () => {
  const call = position({ assetClass: 'us_option', symbol: 'SPY261009C00500000', quantity: -1, side: 'short', marketValue: -1200 });
  const uncovered = deriveAccountExposure(account(), [call], []);
  assert.equal(uncovered.portfolioCapitalAtRiskPct, null);
  assert.deepEqual(uncovered.unclassifiedPositionSymbols, [call.symbol]);
  const covered = deriveAccountExposure(account(), [call, position({ symbol: 'SPY', quantity: 100, marketValue: 50_000 })], []);
  assert.equal(covered.portfolioCapitalAtRiskPct, 0.5);
  assert.deepEqual(covered.unclassifiedPositionSymbols, []);
});

test('impossible OCC expiries cannot become account or execution identity',()=>{
  for(const date of ['260230','260229','260431','260631','260000','261301'])
    assert.equal(parseOccOptionSymbol(`SPY${date}P00500000`),null,date);
  assert.equal(parseOccOptionSymbol('SPY280229P00500000')?.expiration,'2028-02-29');
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

test('first CSP risk includes the proposed trade and resolves single-risk-group capacity from real broker equity', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], []);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [], {
    underlying: 'SPY', securedCollateralPerContract: 10_000, quantity: 1,
  }, 0);
  assert.equal(result.evidenceState, 'KNOWN_DERIVED_FROM_REAL');
  assert.equal(result.tickerConcentrationPct, 0.1);
  assert.equal(result.sectorConcentrationPct, 0.1);
  assert.equal(result.correlationClusterExposurePct, 0.1);
  assert.equal(result.portfolioCapitalAtRiskPct, 0.1);
  assert.equal(result.assignmentCapacityUsedPct, 0.1);
  assert.equal(result.inventoryCapacityUsedPct, 0);
  assert.equal(result.recoveryCapacityUsedPct, 0);
});

test('candidate capacity permits quantity one while preventing quantity two from crossing the AEGIS hard boundary', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], []);
  const result = deriveCandidateCapacityAssessment(
    exposure,
    [],
    { underlying: 'SPY', securedCollateralPerContract: 10_000 },
    2,
    {
      hardCapMultiplier: 1.5, maxTickerConcentrationPct: 0.1, maxSectorConcentrationPct: 0.1, maxCorrelationClusterPct: 0.1,
      maxPortfolioCapitalAtRiskPct: 0.1, maxInventoryCapacityPct: 0.5,
      maxAssignmentCapacityPct: 0.1, maxRecoveryCapacityPct: 0.5,
    },
    0,
  );
  assert.equal(result.quantityCap, 1);
  assert.ok(result.bindingConstraints.includes('ASSIGNMENT_CAPACITY'));
  assert.equal(result.inputsAtQuantityCap.assignmentCapacityUsedPct, 0.1);
});

test('pending order intent ambiguity preserves candidate-inclusive capacity as UNKNOWN', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], [openOrder()]);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [openOrder()], {
    underlying: 'SPY', securedCollateralPerContract: 10_000, quantity: 1,
  });
  assert.equal(result.evidenceState, 'UNKNOWN_INSUFFICIENT_ACCOUNT_STATE');
  assert.equal(result.assignmentCapacityUsedPct, null);
  assert.ok(result.unknownReasons.includes('PENDING_ORDER_INTENT_NOT_CLASSIFIED'));
});

test('invalid pending option quantities prices or multipliers cannot manufacture zero reserved risk', () => {
  for (const quantity of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = deriveAccountExposure(account(), [], [openOrder({ symbol: 'SPY261009P00500000', positionIntent: 'sell_to_open', quantity })]);
    assert.equal(result.pendingOpeningCapitalAtRisk, null);
    assert.deepEqual(result.unclassifiedOpenOrderIds, ['order-1']);
  }
  for (const limitPrice of [NaN, Infinity, 0]) {
    const result = deriveAccountExposure(account(), [], [openOrder({ symbol: 'SPY261009P00500000', positionIntent: 'buy_to_open', limitPrice })]);
    assert.equal(result.pendingOpeningCapitalAtRisk, null);
  }
  for (const multiplier of [0, -1, NaN, Infinity]) assert.throws(() => deriveAccountExposure(account(), [], [], multiplier), /MULTIPLIER_INVALID/);
});

test('documented sell-to-open position intent turns a pending CSP into real reserved assignment exposure', () => {
  const pending = openOrder({
    symbol: 'SPY261009P00500000', side: 'sell', positionIntent: 'sell_to_open', quantity: 1, limitPrice: 2,
  });
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], [pending]);
  assert.equal(exposure.pendingOpeningCapitalAtRisk, 50_000);
  assert.equal(exposure.pendingAssignmentCollateral, 50_000);
  assert.deepEqual(exposure.unclassifiedOpenOrderIds, []);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [pending], {
    underlying: 'SPY', securedCollateralPerContract: 10_000, quantity: 1,
  }, 0);
  assert.equal(result.evidenceState, 'KNOWN_DERIVED_FROM_REAL');
  assert.equal(result.assignmentCapacityUsedPct, 0.6);
  assert.equal(result.portfolioCapitalAtRiskPct, 0.6);
});

test('documented closing intent is risk reducing and does not block a new capacity calculation', () => {
  const closing = openOrder({
    symbol: 'SPY261009P00500000', side: 'buy', positionIntent: 'buy_to_close', quantity: 1, limitPrice: 2,
  });
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], [closing]);
  assert.equal(exposure.pendingOpeningCapitalAtRisk, 0);
  assert.deepEqual(exposure.unclassifiedOpenOrderIds, []);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [closing], {
    underlying: 'SPY', securedCollateralPerContract: 10_000, quantity: 1,
  }, 0);
  assert.equal(result.evidenceState, 'KNOWN_DERIVED_FROM_REAL');
  assert.equal(result.assignmentCapacityUsedPct, 0.1);
});

test('pending short-call coverage remains UNKNOWN instead of assuming shares exist', () => {
  const uncoveredOrUnknown = openOrder({
    symbol: 'SPY261009C00500000', side: 'sell', positionIntent: 'sell_to_open', quantity: 1, limitPrice: 2,
  });
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [], [uncoveredOrUnknown]);
  assert.equal(exposure.pendingOpeningCapitalAtRisk, null);
  assert.deepEqual(exposure.unclassifiedOpenOrderIds, ['order-1']);
});

test('multi-underlying sector and correlation remain UNKNOWN without a real classification or PIT cluster', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [
    position({ symbol: 'AAPL', assetClass: 'us_equity', marketValue: 10_000 }),
  ], []);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [], {
    underlying: 'SPY', securedCollateralPerContract: 10_000, quantity: 1,
  }, 10_000);
  assert.equal(result.sectorConcentrationPct, null);
  assert.equal(result.correlationClusterExposurePct, null);
  assert.ok(result.unknownReasons.includes('SECTOR_CLASSIFICATION_REQUIRED_FOR_MULTI_UNDERLYING_PORTFOLIO'));
});

test('recovery capacity uses only lifecycle-linked assigned inventory, not every stock holding', () => {
  const exposure = deriveAccountExposure(account({ equity: 100_000 }), [
    position({ symbol: 'AAPL', assetClass: 'us_equity', marketValue: 10_000 }),
    position({ symbol: 'MSFT', assetClass: 'us_equity', marketValue: 20_000 }),
  ], []);
  assert.equal(exposure.stockInventoryValue, 30_000);
  assert.equal(deriveRecoveryInventoryValue(exposure, ['AAPL']), 10_000);
  assert.equal(deriveRecoveryInventoryValue(exposure, []), 0);
  assert.equal(deriveRecoveryInventoryValue(exposure, undefined), null);
  assert.equal(deriveRecoveryInventoryValue(exposure, ['NVDA']), null);
  const result = deriveCandidateInclusiveAegisInputs(exposure, [], {
    underlying: 'AAPL', securedCollateralPerContract: 5_000, quantity: 1,
  }, deriveRecoveryInventoryValue(exposure, ['AAPL']));
  assert.equal(result.inventoryCapacityUsedPct, 0.3);
  assert.equal(result.recoveryCapacityUsedPct, 0.1);
});
