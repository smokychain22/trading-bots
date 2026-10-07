import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateHeroZeroLadder, type HeroZeroObservation, type HeroZeroPolicy }
  from '../src/research/source-replication/hero-zero-ladder.js';

const policy = (overrides: Partial<HeroZeroPolicy> = {}): HeroZeroPolicy => ({
  version: 'fixture-v1', ladderStyle: 'EQUAL_SIZE', exitStyle: 'STAGED', maximumDollarsAtRisk: 300,
  maximumQuantity: 3, ladder: [
    { triggerPremium: 1, quantity: 1, supportEvidenceId: null },
    { triggerPremium: 0.8, quantity: 1, supportEvidenceId: null },
    { triggerPremium: 0.6, quantity: 1, supportEvidenceId: null },
  ], stopPremium: 0.3, scaleOuts: [{ targetPremium: 0.9, quantity: 1 }, { targetPremium: 1.1, quantity: 1 }],
  trailingRunnerQuantity: 1, trailingStopPct: 0.2, perContractRoundTripCostUsd: 1, multiplier: 100, ...overrides,
});
const row = (minute: number, bid: number, ask: number): HeroZeroObservation => ({
  observedAt: `2026-10-07T14:${String(minute).padStart(2, '0')}:00.000Z`,
  providerKnownAt: `2026-10-07T14:${String(minute).padStart(2, '0')}:00.000Z`, bid, ask,
});

test('precommitted ladder reports real path economics and both required counterfactuals', () => {
  const receipt = simulateHeroZeroLadder({ policy: policy(), observations: [
    row(0, 0.85, 1), row(1, 0.74, 0.78), row(2, 0.54, 0.58), row(3, 0.92, 0.95), row(4, 1.12, 1.15), row(5, 0.86, 0.89),
  ] });
  assert.equal(receipt.state, 'COMPLETE');
  assert.equal(receipt.primary?.maximumOpenQuantity, 3);
  assert.equal(receipt.primary?.weightedAverageEntryPremium, 0.79);
  assert.ok(receipt.primary?.fills.some((fill) => fill.reason === 'LADDER_ADD'));
  assert.equal(receipt.counterfactualNoAverage?.maximumOpenQuantity, 1);
  assert.equal(receipt.counterfactualFixedSize?.maximumOpenQuantity, 3);
  assert.equal(receipt.executionAuthorized, false);
  assert.equal(receipt.profitabilityStatus, 'EMPIRICALLY_UNPROVEN');
});

test('maximum loss after every planned add and stop blocks the plan before entry', () => {
  const receipt = simulateHeroZeroLadder({ policy: policy({ maximumDollarsAtRisk: 100 }),
    observations: [row(0, 0.95, 1)] });
  assert.equal(receipt.state, 'INFEASIBLE_PRECOMMITTED_RISK');
  assert.ok((receipt.maximumPrecommittedLossUsd ?? 0) > 100);
  assert.equal(receipt.primary, null);
});

test('support-based adds require named evidence and future-known quotes remain PIT unsafe', () => {
  const unsupported = simulateHeroZeroLadder({ policy: policy({ ladderStyle: 'SUPPORT_BASED' }),
    observations: [row(0, 0.95, 1)] });
  assert.equal(unsupported.state, 'INVALID');
  const future = { ...row(0, 0.95, 1), providerKnownAt: '2026-10-07T14:01:00.000Z' };
  assert.equal(simulateHeroZeroLadder({ policy: policy(), observations: [future] }).state, 'PIT_UNSAFE');
});

test('missing trailing policy stays blocked and a price decline cannot create an unplanned add', () => {
  const missing = simulateHeroZeroLadder({ policy: policy({ exitStyle: 'TRAILING_RUNNER', trailingStopPct: null }),
    observations: [row(0, 0.95, 1)] });
  assert.equal(missing.state, 'BLOCKED_MISSING_POLICY');
  const receipt = simulateHeroZeroLadder({ policy: policy(), observations: [row(0, 1.05, 1.1), row(1, 0.85, 0.9)] });
  assert.equal(receipt.primary?.state, 'COMPLETE');
  assert.equal(receipt.primary?.maximumOpenQuantity, 1);
});
