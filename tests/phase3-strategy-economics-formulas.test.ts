import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type RawOptionQuoteInput } from '../src/theta/option-contract.js';

// Phase 3 (Profitability Brain Completion Program) — real formula
// verification against the actual exported CanonicalStrategyFrontier API.
// These tests exercise real production code read-only (via the public
// buildCanonicalStrategyFrontier entry point) rather than reimplementing
// the formulas -- if the real code ever drifts from the documented
// formulas, these fail loudly instead of silently agreeing with drift.

const RECEIVED_AT = '2026-09-26T15:00:00Z';

function must<T>(value: T | undefined | null, message: string): T {
  assert.ok(value !== undefined && value !== null, message);
  return value as T;
}

function baseRaw(overrides: Partial<RawOptionQuoteInput>): RawOptionQuoteInput {
  return {
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY260101P00500000', occSymbol: 'SPY260101P00500000',
    optionType: 'PUT', strike: 500, expiration: '2026-11-20', asOfDate: '2026-09-26', multiplier: 100,
    underlyingBid: 510, underlyingAsk: 510.1, underlyingLast: 510.05, underlyingTimestamp: RECEIVED_AT,
    bid: 5, ask: 5.2, bidSize: 10, askSize: 10, lastTradePrice: 5.1, lastTradeSize: 5,
    quoteTimestamp: RECEIVED_AT, tradeTimestamp: RECEIVED_AT, volume: 100, volumeSource: 'ALPACA',
    openInterest: 500, openInterestSource: 'ALPACA', iv: 0.22, delta: -0.2, gamma: 0.01, theta: -0.05,
    vega: 0.1, rho: 0.01, greeksTimestamp: RECEIVED_AT, greeksSource: 'ALPACA', feed: 'OPRA',
    dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 600, maxSpreadPctForExecutable: 0.5,
    ...overrides,
  };
}

function routingAllEligible(snapshotId: string, timestamp: string): CanonicalStrategyFrontierInput['routing'] {
  const families = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const;
  return {
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId, timestamp, policyVersion: 'test-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: true, eligibilityState: 'ELIGIBLE_PRIMARY' as const,
      reasons: [{ code: 'TEST_ELIGIBLE', polarity: 1 as const, detail: 'fixture' }], policyVersion: 'test-v1',
    })),
  };
}

function baseInput(overrides: Partial<CanonicalStrategyFrontierInput> = {}): CanonicalStrategyFrontierInput {
  const snapshotId = 'snap-1';
  const timestamp = RECEIVED_AT;
  return {
    snapshotId, timestamp, strategyVersion: 'test-v1', contracts: [],
    routing: routingAllEligible(snapshotId, timestamp),
    stock: null, assignmentCapacityQty: 5, buyingPower: 100_000,
    aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR', unmanagedBrokerPositionCount: 0,
    unevaluatedUnderlyingCount: 0, optionomicsContext: {},
    sizingPolicy: {
      riskBudgetQtyCap: 10, collateralQtyCap: 10, concentrationQtyCap: 10, assignmentCapacityQtyCap: 10,
      tailRiskQtyCap: 10, correlationQtyCap: 10, liquidityQtyCap: 10, reducedStateMultiplier: 0.5,
    },
    openingCostPolicy: { commissionPerContract: 0.65, feesPerContract: 0.05,
      estimatedSlippagePerContract: 1, costModelVersion: 'test-cost-v1' },
    ...overrides,
  };
}

test('CORE CLAIM (3F): defined-risk maxLoss/maxProfit/breakEven exactly match the documented formula', () => {
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-SHORT', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const longPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-LONG', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const input = baseInput({ contracts: [shortPut, longPut] });
  const frontier = buildCanonicalStrategyFrontier(input);
  const branch = must(frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK'), 'THETA_DEFINED_RISK branch must exist');
  const candidate = must(branch.candidates.find((c) => c.legs.length === 2), 'a real two-leg D candidate must be constructed from this fixture');

  // Documented formula (Command 3, re-verified here against real code):
  // netCredit = shortPut.bid - longPut.ask (conservative-side pricing)
  const expectedNetCredit = 5 - 1.7;
  const expectedWidth = 500 - 490;
  const expectedMaxProfit = expectedNetCredit * 100;
  const expectedMaxLoss = (expectedWidth - expectedNetCredit) * 100;
  const expectedBreakEven = 500 - expectedNetCredit;

  assert.equal(candidate.economics.maxProfit, expectedMaxProfit);
  assert.equal(candidate.economics.maxLoss, expectedMaxLoss);
  assert.equal(candidate.economics.breakEven, expectedBreakEven);
  assert.equal(candidate.economics.collateral, expectedMaxLoss, 'D collateral is defined as maxLoss, never undefined-risk collateral');
  assert.equal(candidate.multiLegRiskEvidence?.state, 'STRUCTURAL_READY_FILL_UNCALIBRATED');
  assert.equal(candidate.multiLegRiskEvidence?.shortLegQuoteState, 'TWO_SIDED');
  assert.equal(candidate.multiLegRiskEvidence?.longLegQuoteState, 'TWO_SIDED');
  assert.equal(candidate.multiLegRiskEvidence?.simultaneousFillState, 'NOT_OBSERVED_RESEARCH_ONLY');
  assert.equal(candidate.multiLegRiskEvidence?.fillRiskState, 'UNCALIBRATED');
  assert.equal(candidate.multiLegRiskEvidence?.expiration, shortPut.expiration);
  assert.ok(typeof candidate.multiLegRiskEvidence?.shortStrikePinDistancePct === 'number');
});

test('CLOSED (Phase 3, THETA-Q-CSP-MAXLOSS-NOT-POPULATED): Q single-leg CSP maxLoss now matches the Command 3 formula (strike*multiplier - creditReceived, gross of costs) instead of always being null', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-CSP', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const input = baseInput({ contracts: [put] });
  const frontier = buildCanonicalStrategyFrontier(input);
  const branch = must(frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL'), 'THETA_CONVENTIONAL branch must exist');
  const candidate = must(branch.candidates.find((c) => c.action === 'OPEN_CSP'), 'a real Q CSP candidate must be constructed from this fixture');
  // Fixed in canonical-strategy-frontier.ts's singleLegPutCandidate(): the
  // formula's inputs (strike, credit, multiplier) were always present on
  // the candidate -- this was a real, closeable gap, not a genuine
  // data-availability UNKNOWN, confirmed here by cross-checking collateral
  // and premiumPerShare independently against the same fixture.
  assert.equal(candidate.economics.collateral, 500 * 100);
  assert.equal(candidate.economics.premiumPerShare, 5);
  const expectedCreditReceived = 5 * 100;
  const expectedMaxLoss = 500 * 100 - expectedCreditReceived;
  assert.equal(candidate.economics.maxLoss, expectedMaxLoss);
  const collateral = must(candidate.economics.collateral, 'collateral must be known');
  const maxProfit = must(candidate.economics.maxProfit, 'maxProfit must be known');
  assert.equal(candidate.economics.maxLoss, collateral - maxProfit);
});

test('capital-days is first-class on both Q and D economics (capitalDayYield present, computed from real dte)', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-CSP2', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-SHORT2', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const longPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-LONG2', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const frontier = buildCanonicalStrategyFrontier(baseInput({ contracts: [put, shortPut, longPut] }));
  const qBranch = must(frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL'), 'Q branch');
  const dBranch = must(frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK'), 'D branch');
  const q = must(qBranch.candidates.find((c) => c.action === 'OPEN_CSP'), 'Q candidate');
  const d = must(dBranch.candidates.find((c) => c.legs.length === 2), 'D candidate');
  assert.ok(typeof q.economics.capitalDayYield === 'number' && Number.isFinite(q.economics.capitalDayYield));
  assert.ok(typeof d.economics.capitalDayYield === 'number' && Number.isFinite(d.economics.capitalDayYield));
});

test('after-cost EV is always typed null on both Q and D -- delta is never substituted as a probability (STAT-001)', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-CSP3' }), RECEIVED_AT);
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-SHORT3', strike: 500 }), RECEIVED_AT);
  const longPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-LONG3', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const frontier = buildCanonicalStrategyFrontier(baseInput({ contracts: [put, shortPut, longPut] }));
  const qBranch = must(frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL'), 'Q branch');
  const dBranch = must(frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK'), 'D branch');
  const q = must(qBranch.candidates.find((c) => c.action === 'OPEN_CSP'), 'Q candidate');
  const d = must(dBranch.candidates.find((c) => c.legs.length === 2), 'D candidate');
  assert.equal(q.economics.expectedAfterCostEv, null);
  assert.equal(d.economics.expectedAfterCostEv, null);
  // real delta is present but never used to derive expectedAfterCostEv
  assert.equal(q.delta, -0.2);
});

test('defined-risk rejects an impossible credit at or above spread width', () => {
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-IMPOSSIBLE-S', strike: 500, bid: 12, ask: 12.2 }), RECEIVED_AT);
  const longPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-IMPOSSIBLE-L', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const candidate = must(buildCanonicalStrategyFrontier(baseInput({ contracts: [shortPut, longPut] }))
    .branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates
    .find((c) => c.legs[0]?.optionSymbol === 'SPY-IMPOSSIBLE-S' && c.legs[1]?.optionSymbol === 'SPY-IMPOSSIBLE-L'),
  'impossible D candidate');
  assert.equal(candidate.structurallyFeasible, false);
  assert.ok(candidate.hardBlockers.includes('NET_CREDIT_NOT_BELOW_SPREAD_WIDTH'));
});

test('Phase 4 opening-cost arithmetic charges one option leg for Q and both legs for D without fabricating EV', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-COST-Q', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-COST-D-S', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const longPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-COST-D-L', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const frontier = buildCanonicalStrategyFrontier(baseInput({ contracts: [put, shortPut, longPut] }));
  const q = must(frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates
    .find((c) => c.legs[0]?.optionSymbol === 'SPY-COST-Q'), 'Q cost candidate');
  const d = must(frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates
    .find((c) => c.legs[0]?.optionSymbol === 'SPY-COST-D-S' && c.legs[1]?.optionSymbol === 'SPY-COST-D-L'), 'D cost candidate');
  assert.equal(q.economics.modeledOpeningCosts.optionLegCount, 1);
  assert.ok(Math.abs(must(q.economics.modeledOpeningCosts.total, 'Q total cost') - 1.7) < 1e-12);
  assert.equal(d.economics.modeledOpeningCosts.optionLegCount, 2);
  assert.ok(Math.abs(must(d.economics.modeledOpeningCosts.total, 'D total cost') - 3.4) < 1e-12);
  assert.ok(Math.abs(must(q.economics.modeledOpeningCosts.maxProfitAfterOpeningCost, 'Q net max profit')
    - (must(q.economics.maxProfit, 'Q gross max profit') - 1.7)) < 1e-12);
  assert.ok(Math.abs(must(d.economics.modeledOpeningCosts.maxLossAfterOpeningCost, 'D net max loss')
    - (must(d.economics.maxLoss, 'D gross max loss') + 3.4)) < 1e-12);
  assert.equal(q.economics.expectedAfterCostEv, null);
  assert.equal(d.economics.expectedAfterCostEv, null);
});

test('Phase 4 monotonicity: higher fees and slippage cannot improve cost-adjusted outcomes', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-COST-MONO', strike: 500, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const low = buildCanonicalStrategyFrontier(baseInput({ contracts: [put], openingCostPolicy: {
    commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 0.25,
    costModelVersion: 'low-cost-v1',
  } })).branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const high = buildCanonicalStrategyFrontier(baseInput({ contracts: [put], openingCostPolicy: {
    commissionPerContract: 0.65, feesPerContract: 1.05, estimatedSlippagePerContract: 2.25,
    costModelVersion: 'high-cost-v1',
  } })).branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(low && high);
  assert.ok(must(high.economics.modeledOpeningCosts.total, 'high total cost')
    > must(low.economics.modeledOpeningCosts.total, 'low total cost'));
  assert.ok(must(high.economics.modeledOpeningCosts.maxProfitAfterOpeningCost, 'high-cost max profit')
    < must(low.economics.modeledOpeningCosts.maxProfitAfterOpeningCost, 'low-cost max profit'));
  assert.ok(must(high.economics.modeledOpeningCosts.maxLossAfterOpeningCost, 'high-cost max loss')
    > must(low.economics.modeledOpeningCosts.maxLossAfterOpeningCost, 'low-cost max loss'));
  assert.ok(must(high.economics.modeledOpeningCosts.capitalDayYieldAfterOpeningCost, 'high-cost capital-day yield')
    < must(low.economics.modeledOpeningCosts.capitalDayYieldAfterOpeningCost, 'low-cost capital-day yield'));
});

test('Phase 4 monotonicity: higher collateral cannot improve capital-day efficiency when net premium is unchanged', () => {
  const lowerCapital = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-CAP-LOW', strike: 400,
    underlyingBid: 510, underlyingAsk: 510.1, underlyingLast: 510.05, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const higherCapital = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-CAP-HIGH', strike: 500,
    underlyingBid: 510, underlyingAsk: 510.1, underlyingLast: 510.05, bid: 5, ask: 5.2 }), RECEIVED_AT);
  const candidates = buildCanonicalStrategyFrontier(baseInput({ contracts: [lowerCapital, higherCapital] }))
    .branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates ?? [];
  const low = must(candidates.find((c) => c.legs[0]?.optionSymbol === 'SPY-CAP-LOW'), 'low-capital candidate');
  const high = must(candidates.find((c) => c.legs[0]?.optionSymbol === 'SPY-CAP-HIGH'), 'high-capital candidate');
  assert.ok(must(high.economics.collateral, 'high collateral') > must(low.economics.collateral, 'low collateral'));
  assert.ok(must(high.economics.modeledOpeningCosts.capitalDayYieldAfterOpeningCost, 'high-capital yield')
    < must(low.economics.modeledOpeningCosts.capitalDayYieldAfterOpeningCost, 'low-capital yield'));
});

test('Phase 4 missing opening-cost policy stays UNKNOWN rather than becoming zero cost', () => {
  const put = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-COST-UNKNOWN' }), RECEIVED_AT);
  const candidate = must(buildCanonicalStrategyFrontier(baseInput({ contracts: [put], openingCostPolicy: null }))
    .branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0], 'Q candidate');
  assert.equal(candidate.economics.modeledOpeningCosts.state, 'UNKNOWN');
  assert.equal(candidate.economics.modeledOpeningCosts.total, null);
  assert.equal(candidate.economics.modeledOpeningCosts.netPremiumAfterOpeningCost, null);
});

test('serious alternatives are persisted, not just the frontier winner: multiple candidates survive per branch', () => {
  const shortPut = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-SHORT4', strike: 500 }), RECEIVED_AT);
  const longPutA = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-LONG4A', strike: 490, bid: 1.5, ask: 1.7 }), RECEIVED_AT);
  const longPutB = normalizeOptionContract(baseRaw({ optionSymbol: 'SPY-LONG4B', strike: 480, bid: 1.0, ask: 1.2 }), RECEIVED_AT);
  const frontier = buildCanonicalStrategyFrontier(baseInput({ contracts: [shortPut, longPutA, longPutB] }));
  const branch = must(frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK'), 'D branch');
  // Two distinct long-leg widths against the same short leg -> two distinct
  // real D structures, both retained (not just branch.bestCandidateId).
  assert.ok(branch.candidates.length >= 2, 'more than one serious structure alternative must be retained per branch');
});
