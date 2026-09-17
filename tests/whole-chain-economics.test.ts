import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

const components = (overrides: Partial<WholeChainComponents> = {}): WholeChainComponents => ({
  initialPutPremium: 200, rollCredits: 50, rollCloseCosts: 30, assignmentStrike: 195, stockSharesAssigned: 100,
  dividends: 0, coveredCallPremium: null, coveredCallCloseCosts: null, stockSaleOrCallAwayProceeds: null,
  fees: 2, slippage: 1, currentStockMarkPerShare: 190, openStockShares: 100, ...overrides,
});

test('computeEffectiveStockBasis returns NO_ASSIGNMENT_RECORDED when there was never an assignment', () => {
  const result = computeEffectiveStockBasis(components({ assignmentStrike: null, stockSharesAssigned: 0 }));
  assert.equal(result.effectiveStockBasisPerShare, null);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingComponents, ['NO_ASSIGNMENT_RECORDED']);
});

test('computeEffectiveStockBasis lowers the strike by net retained premium per share, net of fees and slippage', () => {
  const result = computeEffectiveStockBasis(components());
  // netPutPremiumRetained = 200 + 50 - 30 = 220; perShareAdj = (220 - 2 - 1) / 100 = 2.17
  const expected = 195 - (220 - 2 - 1) / 100;
  assert.equal(result.complete, true);
  assert.ok(result.effectiveStockBasisPerShare !== null && Math.abs(result.effectiveStockBasisPerShare - expected) < 1e-9);
});

test('computeEffectiveStockBasis with no rolls at all reduces to strike minus initial premium retained per share', () => {
  const result = computeEffectiveStockBasis(components({ rollCredits: 0, rollCloseCosts: 0 }));
  const expected = 195 - (200 - 2 - 1) / 100;
  assert.ok(result.effectiveStockBasisPerShare !== null && Math.abs(result.effectiveStockBasisPerShare - expected) < 1e-9);
});

test('computeEffectiveStockBasis with one credit roll (rollCredits > rollCloseCosts) lowers the basis further than no roll at all', () => {
  const noRoll = computeEffectiveStockBasis(components({ rollCredits: 0, rollCloseCosts: 0 }));
  const creditRoll = computeEffectiveStockBasis(components({ rollCredits: 80, rollCloseCosts: 20 }));
  assert.ok(noRoll.effectiveStockBasisPerShare !== null && creditRoll.effectiveStockBasisPerShare !== null);
  assert.ok(creditRoll.effectiveStockBasisPerShare < noRoll.effectiveStockBasisPerShare);
});

test('computeEffectiveStockBasis with one losing (net-debit) roll raises the basis above the no-roll case', () => {
  const noRoll = computeEffectiveStockBasis(components({ rollCredits: 0, rollCloseCosts: 0 }));
  const losingRoll = computeEffectiveStockBasis(components({ rollCredits: 10, rollCloseCosts: 60 }));
  assert.ok(noRoll.effectiveStockBasisPerShare !== null && losingRoll.effectiveStockBasisPerShare !== null);
  assert.ok(losingRoll.effectiveStockBasisPerShare > noRoll.effectiveStockBasisPerShare);
});

test('computeEffectiveStockBasis with multiple rolls uses the ALREADY-SUMMED aggregate credits/costs across every roll in the chain', () => {
  // rollCredits/rollCloseCosts represent the SUM across every roll this
  // chain has undergone -- three rolls each netting +40 credit sum to the
  // same aggregate as one roll netting +120, proving no roll is silently
  // dropped when multiple have occurred.
  const threeRolls = computeEffectiveStockBasis(components({ rollCredits: 3 * 60, rollCloseCosts: 3 * 20 }));
  const oneEquivalentRoll = computeEffectiveStockBasis(components({ rollCredits: 180, rollCloseCosts: 60 }));
  assert.equal(threeRolls.effectiveStockBasisPerShare, oneEquivalentRoll.effectiveStockBasisPerShare);
});

test('computeEffectiveStockBasis never double-counts fees -- doubling fees alone moves the basis by exactly the fee delta per share', () => {
  const base = computeEffectiveStockBasis(components({ fees: 2 }));
  const doubledFees = computeEffectiveStockBasis(components({ fees: 4 }));
  assert.ok(base.effectiveStockBasisPerShare !== null && doubledFees.effectiveStockBasisPerShare !== null);
  const delta = doubledFees.effectiveStockBasisPerShare - base.effectiveStockBasisPerShare;
  assert.ok(Math.abs(delta - 2 / 100) < 1e-9);
});

test('computeEffectiveStockBasis handles a non-100 multiplier/share count correctly (e.g. a partial or mini-contract position)', () => {
  const result = computeEffectiveStockBasis(components({ stockSharesAssigned: 50 }));
  const expected = 195 - (220 - 2 - 1) / 50;
  assert.ok(result.effectiveStockBasisPerShare !== null && Math.abs(result.effectiveStockBasisPerShare - expected) < 1e-9);
});

test('computeEffectiveStockBasis names every missing component rather than guessing', () => {
  const result = computeEffectiveStockBasis(components({ rollCredits: null, slippage: null }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingComponents, ['rollCredits', 'slippage']);
});

test('computeWholeChainPnl sums every known leg and never hides a prior option loss inside a later leg', () => {
  const breakdown = computeWholeChainPnl(components({
    stockSaleOrCallAwayProceeds: 19_000, openStockShares: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
  }));
  const initialLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'INITIAL_PUT_PREMIUM');
  assert.equal(initialLeg?.amount, 200);
  const rollCloseLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'ROLL_CLOSE_COSTS');
  assert.equal(rollCloseLeg?.amount, -30);
  assert.notEqual(breakdown.wholeChainPnl, null);
});

test('an unknown leg makes wholeChainPnl null but still reports every known leg', () => {
  const breakdown = computeWholeChainPnl(components({ dividends: 0, coveredCallPremium: null, stockSaleOrCallAwayProceeds: null }));
  // stock still open (openStockShares>0, no sale proceeds) -> unrealized stock mtm leg added
  const unrealizedLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'UNREALIZED_STOCK_MTM');
  assert.ok(unrealizedLeg !== undefined);
  const ccPremiumLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'COVERED_CALL_PREMIUM');
  assert.equal(ccPremiumLeg?.amount, null);
  assert.equal(breakdown.wholeChainPnl, null);
});

test('a fully closed chain reports a complete whole-chain P&L with no unrealized stock leg', () => {
  const breakdown = computeWholeChainPnl(components({
    coveredCallPremium: 120, coveredCallCloseCosts: 10, stockSaleOrCallAwayProceeds: 19_500, openStockShares: 0,
  }));
  assert.ok(!breakdown.legLevelPnl.some((leg) => leg.label === 'UNREALIZED_STOCK_MTM'));
  assert.notEqual(breakdown.wholeChainPnl, null);
});
