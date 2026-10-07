import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateGammaScalping, type GammaHedgePolicy, type GammaScalpObservation }
  from '../src/research/source-replication/gamma-scalping.js';

const policy = (overrides: Partial<GammaHedgePolicy> = {}): GammaHedgePolicy => ({
  version: 'fixture', algorithm: 'DELTA_THRESHOLD', timeIntervalMinutes: null, deltaThresholdShares: 10,
  priceMoveThresholdPct: null, gammaBandSpotMove: null, volatilityAdaptiveBaseDeltaShares: null,
  underlyingCostPerShareTraded: 0.01, ...overrides,
});
const row = (hour: number, spot: number, mark: number, delta: number, iv = 0.3): GammaScalpObservation => ({
  observedAt: `2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
  providerKnownAt: `2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`, spot,
  optionLiquidationValuePerShare: mark, netDeltaPerShare: delta, gammaPerSharePerDollar: 0.04,
  thetaPerSharePerDay: -0.08, vegaPerSharePerVolPoint: 0.2, impliedVolatility: iv,
});

test('delta-threshold simulation hedges, liquidates, and separates costs and PnL attribution', () => {
  const receipt = simulateGammaScalping({ observations: [row(14, 100, 5.8, 0), row(15, 102, 6.4, 0.2), row(16, 99, 6.1, -0.1)],
    policy: policy(), contracts: 1, multiplier: 100, entryDebitPerShare: 6, optionEntryCostsUsd: 2, optionExitCostsUsd: 2 });
  assert.equal(receipt.state, 'COMPLETE');
  assert.equal(receipt.hedgeCount, 2);
  assert.equal(receipt.hedgeTrades.at(-1)?.reason, 'FINAL_LIQUIDATION');
  assert.ok((receipt.pnl.transactionCostsUsd ?? 0) > 4);
  assert.notEqual(receipt.pnl.gammaContributionUsd, null);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.profitabilityStatus, 'EMPIRICALLY_UNPROVEN');
});

test('missing algorithm threshold blocks simulation rather than inventing a hedge rule', () => {
  const receipt = simulateGammaScalping({ observations: [row(14, 100, 5.8, 0), row(15, 101, 6, 0.1)],
    policy: policy({ deltaThresholdShares: null }), contracts: 1, multiplier: 100, entryDebitPerShare: 6,
    optionEntryCostsUsd: null, optionExitCostsUsd: null });
  assert.equal(receipt.state, 'BLOCKED_MISSING_POLICY');
  assert.equal(receipt.pnl.netPnlUsd, null);
});

test('future-known Greek evidence is PIT unsafe', () => {
  const future = { ...row(15, 101, 6, 0.1), providerKnownAt: '2026-10-07T16:00:00.000Z' };
  const receipt = simulateGammaScalping({ observations: [row(14, 100, 5.8, 0), future], policy: policy(),
    contracts: 1, multiplier: 100, entryDebitPerShare: 6, optionEntryCostsUsd: 0, optionExitCostsUsd: 0 });
  assert.equal(receipt.state, 'PIT_UNSAFE');
  assert.equal(receipt.pnl.netPnlUsd, null);
});

test('time, price, gamma and volatility adaptive policies are executable research algorithms', () => {
  const observations = [row(14, 100, 5.8, 0), row(15, 102, 6.4, 0.2), row(16, 99, 6.1, -0.1)];
  const policies: GammaHedgePolicy[] = [
    policy({ algorithm: 'TIME_BASED', timeIntervalMinutes: 30, deltaThresholdShares: null }),
    policy({ algorithm: 'PRICE_MOVE_THRESHOLD', priceMoveThresholdPct: 0.01, deltaThresholdShares: null }),
    policy({ algorithm: 'GAMMA_BAND', gammaBandSpotMove: 1, deltaThresholdShares: null }),
    policy({ algorithm: 'VOLATILITY_ADAPTIVE', volatilityAdaptiveBaseDeltaShares: 5, deltaThresholdShares: null }),
  ];
  for (const item of policies) {
    const receipt = simulateGammaScalping({ observations, policy: item, contracts: 1, multiplier: 100,
      entryDebitPerShare: 6, optionEntryCostsUsd: 0, optionExitCostsUsd: 0 });
    assert.equal(receipt.state, 'COMPLETE', item.algorithm);
    assert.ok(receipt.hedgeCount > 0, item.algorithm);
  }
});
