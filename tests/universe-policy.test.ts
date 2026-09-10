import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateUnderlying, evaluateUniverse, type UnderlyingCandidateInput, type UniversePolicy } from '../src/theta/universe-policy.js';

const policy: UniversePolicy = { policyVersion: 'universe-v1', minAvgDollarVolume: 10_000_000, minCurrentPrice: 5 };

const clean = (overrides: Partial<UnderlyingCandidateInput> = {}): UnderlyingCandidateInput => ({
  symbol: 'SPY', tradable: true, optionEnabled: true, assetDataValid: true,
  avgDollarVolume: 50_000_000, currentPrice: 500, hasUsableOptionChain: true,
  accountCollateralFeasible: true, ownershipAcceptable: true,
  unsupportedCorporateActionPending: false, eventNear: false,
  ...overrides,
});

test('a fully clean underlying is ELIGIBLE after all stages', () => {
  const result = evaluateUnderlying(policy, clean());
  assert.equal(result.state, 'ELIGIBLE');
  assert.equal(result.terminalStage, 'EVENT_AWARENESS');
});

test('not tradable is a hard REJECTED at stage A', () => {
  const result = evaluateUnderlying(policy, clean({ tradable: false }));
  assert.equal(result.state, 'REJECTED');
  assert.equal(result.terminalStage, 'BASE_OPTIONABLE');
});

test('not option-enabled is a hard REJECTED at stage A', () => {
  const result = evaluateUnderlying(policy, clean({ optionEnabled: false }));
  assert.equal(result.state, 'REJECTED');
});

test('unknown current price is a hard DEFERRED (structurally cannot evaluate economics) at stage B', () => {
  const result = evaluateUnderlying(policy, clean({ currentPrice: null }));
  assert.equal(result.state, 'DEFERRED');
  assert.equal(result.terminalStage, 'LIQUIDITY_SCREEN');
});

test('liquidity below the SOFT floor is DEFERRED, never REJECTED -- anti-paralysis', () => {
  const result = evaluateUnderlying(policy, clean({ avgDollarVolume: 1_000_000 }));
  assert.equal(result.state, 'DEFERRED');
  assert.notEqual(result.state, 'REJECTED');
});

test('no usable option chain at all is a hard REJECTED, distinct from merely-low liquidity', () => {
  const result = evaluateUnderlying(policy, clean({ hasUsableOptionChain: false }));
  assert.equal(result.state, 'REJECTED');
});

test('momentary account-collateral infeasibility is DEFERRED, never a permanent rejection -- Q=0 remains legitimate downstream', () => {
  const result = evaluateUnderlying(policy, clean({ accountCollateralFeasible: false }));
  assert.equal(result.state, 'DEFERRED');
  assert.equal(result.terminalStage, 'ACCOUNT_CAPACITY');
});

test('unknown ownership is DEFERRED, never assumed acceptable', () => {
  const result = evaluateUnderlying(policy, clean({ ownershipAcceptable: null }));
  assert.equal(result.state, 'DEFERRED');
});

test('an unsupported corporate action is a hard REJECTED', () => {
  const result = evaluateUnderlying(policy, clean({ unsupportedCorporateActionPending: true }));
  assert.equal(result.state, 'REJECTED');
  assert.equal(result.terminalStage, 'EVENT_AWARENESS');
});

test('event proximity alone is DEFERRED, never an automatic veto', () => {
  const result = evaluateUnderlying(policy, clean({ eventNear: true }));
  assert.equal(result.state, 'DEFERRED');
});

test('anti-paralysis: this policy has no hard gate for "weak trend" or any technical-indicator condition -- only the documented hard gates exist', () => {
  // There is no field on UnderlyingCandidateInput for RSI/MACD/GEX/flow/etc,
  // and clean() with every hard-gate field satisfied always reaches
  // ELIGIBLE regardless of any soft signal -- this is a structural
  // guarantee (the type itself has no such field), not merely a test
  // assertion that could silently drift.
  const result = evaluateUnderlying(policy, clean());
  assert.equal(result.state, 'ELIGIBLE');
});

test('evaluateUniverse funnel report shows exactly where each rejected/deferred underlying died', () => {
  const inputs = [
    clean({ symbol: 'A' }), // eligible
    clean({ symbol: 'B', tradable: false }), // rejected at BASE_OPTIONABLE
    clean({ symbol: 'C', avgDollarVolume: 100 }), // deferred at LIQUIDITY_SCREEN
    clean({ symbol: 'D', ownershipAcceptable: false }), // deferred at OWNERSHIP_SUITABILITY
  ];
  const { funnel } = evaluateUniverse(policy, inputs);
  assert.equal(funnel.totalEvaluated, 4);
  assert.equal(funnel.eligible, 1);
  assert.equal(funnel.deferred, 2);
  assert.equal(funnel.rejected, 1);
  assert.equal(funnel.byStage.BASE_OPTIONABLE.rejected, 1);
  assert.equal(funnel.byStage.LIQUIDITY_SCREEN.deferred, 1);
  assert.equal(funnel.byStage.OWNERSHIP_SUITABILITY.deferred, 1);
});

test('a zero-eligible scan is still fully explainable via the funnel, never just "PASS"', () => {
  const inputs = [clean({ symbol: 'A', tradable: false }), clean({ symbol: 'B', optionEnabled: false })];
  const { funnel } = evaluateUniverse(policy, inputs);
  assert.equal(funnel.eligible, 0);
  assert.equal(funnel.byStage.BASE_OPTIONABLE.rejected, 2);
});
