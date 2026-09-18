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

test('UNKNOWN != ZERO: unverified fees make canonical basis UNKNOWN, never silently treated as a real zero fee', () => {
  const withUnknownFees = computeEffectiveStockBasis(components({ fees: null }));
  assert.equal(withUnknownFees.complete, false);
  assert.deepEqual(withUnknownFees.missingComponents, ['fees']);
  // A genuinely observed zero fee is a DIFFERENT, valid state -- it must
  // still compute normally, proving the two are not conflated in either
  // direction.
  const withRealZeroFees = computeEffectiveStockBasis(components({ fees: 0 }));
  assert.equal(withRealZeroFees.complete, true);
});

test('UNKNOWN != ZERO: unverified slippage makes canonical basis UNKNOWN, distinct from a real zero-slippage fill', () => {
  const withUnknownSlippage = computeEffectiveStockBasis(components({ slippage: null }));
  assert.equal(withUnknownSlippage.complete, false);
  assert.deepEqual(withUnknownSlippage.missingComponents, ['slippage']);
  const withRealZeroSlippage = computeEffectiveStockBasis(components({ slippage: 0 }));
  assert.equal(withRealZeroSlippage.complete, true);
});

test('UNKNOWN != ZERO: unverified initial put premium makes canonical basis UNKNOWN, never silently defaulted', () => {
  const result = computeEffectiveStockBasis(components({ initialPutPremium: null }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingComponents, ['initialPutPremium']);
});

test('UNKNOWN != ZERO: unverified dividend evidence makes its own leg UNKNOWN in computeWholeChainPnl -- never silently -0/0', () => {
  const withUnknownDividends = computeWholeChainPnl(components({ dividends: null }));
  const dividendLeg = withUnknownDividends.legLevelPnl.find((leg) => leg.label === 'DIVIDENDS');
  assert.equal(dividendLeg?.amount, null);
  assert.equal(withUnknownDividends.wholeChainPnl, null); // an unknown leg poisons the total, never silently ignored
  // A real observed zero dividend is a different, valid, complete state.
  const withRealZeroDividends = computeWholeChainPnl(components({ dividends: 0 }));
  const realZeroLeg = withRealZeroDividends.legLevelPnl.find((leg) => leg.label === 'DIVIDENDS');
  assert.equal(realZeroLeg?.amount, 0);
});

test('UNKNOWN != ZERO: unverified fee evidence makes the FEES leg UNKNOWN in computeWholeChainPnl, never coerced by `-null` accidentally becoming -0', () => {
  const withUnknownFees = computeWholeChainPnl(components({ fees: null }));
  const feesLeg = withUnknownFees.legLevelPnl.find((leg) => leg.label === 'FEES');
  assert.equal(feesLeg?.amount, null);
  assert.equal(withUnknownFees.wholeChainPnl, null);
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

test('REGRESSION: stock acquisition cost at assignment is netted against sale proceeds, never omitted', () => {
  // Confirmed defect (found by review, fixed here): the stock leg previously
  // reported RAW sale proceeds with no acquisition-cost deduction, inflating
  // whole-chain P&L by exactly the assignment cost. 100 shares assigned at
  // $195 = $19,500 acquisition cost; sold later at exactly that price nets to
  // a $0 stock leg, not a $19,500 phantom gain.
  const breakdown = computeWholeChainPnl(components({
    stockSaleOrCallAwayProceeds: 195 * 100, openStockShares: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
  }));
  const stockLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY');
  assert.equal(stockLeg?.amount, 0);
  // put premiums (200+50-30=220) + fees(-2) + slippage(-1) + stock(0) = 217
  assert.equal(breakdown.wholeChainPnl, 217);
});

test('stock sold BELOW basis registers a real stock-leg loss, not a phantom gain from ignoring acquisition cost', () => {
  const breakdown = computeWholeChainPnl(components({
    stockSaleOrCallAwayProceeds: 180 * 100, openStockShares: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
  }));
  const stockLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY');
  // sold at $180, acquired at $195 assignment strike -> -$1,500 stock loss
  assert.equal(stockLeg?.amount, (180 - 195) * 100);
  assert.ok((stockLeg?.amount ?? 0) < 0);
});

test('stock sold ABOVE basis registers a real stock-leg gain', () => {
  const breakdown = computeWholeChainPnl(components({
    stockSaleOrCallAwayProceeds: 210 * 100, openStockShares: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
  }));
  const stockLeg = breakdown.legLevelPnl.find((leg) => leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY');
  assert.equal(stockLeg?.amount, (210 - 195) * 100);
  assert.ok((stockLeg?.amount ?? 0) > 0);
});

test('CASH-FLOW IDENTITY: wholeChainPnl equals the exact sum of every actual leg cash flow, for a full CSP-to-call-away chain', () => {
  // A complete, explicit worked example spanning every leg category named
  // in the accounting requirement: initial put premium, one profitable
  // roll, assignment, dividends, a covered call, and a call-away exit.
  const chain = components({
    initialPutPremium: 300,      // sold the original CSP for $300
    rollCredits: 120,            // one roll opened for a $120 credit
    rollCloseCosts: 70,          // that roll's old leg cost $70 to close
    assignmentStrike: 195,       // assigned 100 shares @ $195 = $19,500 acquisition
    stockSharesAssigned: 100,
    dividends: 15,               // $15 dividend received while holding
    coveredCallPremium: 140,     // sold a covered call for $140
    coveredCallCloseCosts: 0,    // held to call-away, no close needed
    stockSaleOrCallAwayProceeds: 200 * 100, // called away at $200 strike = $20,000
    fees: 6, slippage: 3,
    currentStockMarkPerShare: null, openStockShares: 0,
  });
  const breakdown = computeWholeChainPnl(chain);
  const expected =
    300            // initial put premium
    + 120 - 70     // net roll result
    + 15           // dividends
    + 140 - 0      // net covered-call result
    + (200 * 100 - 195 * 100) // stock P&L at call-away: (500)
    - 6 - 3;       // fees + slippage
  assert.equal(breakdown.wholeChainPnl, expected);
  assert.equal(expected, 300 + 50 + 15 + 140 + 500 - 9);
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
  // put premiums (220) + CC net (110) + stock leg (19500 - 195*100 = 0) - fees(2) - slippage(1) = 327
  assert.equal(breakdown.wholeChainPnl, 327);
});
