import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { computeCandidatePositionEconomics, computeShortPutAssignmentEntryExposure } from '../src/theta/candidate-position-economics.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 3 Final Closure B: per-contract vs position-total is no longer
// left implicit. computeCandidatePositionEconomics is the one canonical
// place a quantity is applied to a CanonicalFrontierCandidate's economics.

const NOW = '2026-09-14T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3,
    assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2,
    liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

function num(value: number | null, message: string): number {
  assert.ok(value !== null, message);
  return value as number;
}

function qCandidate() {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_Q']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  return candidate;
}

test('QUANTITY MATRIX: position economics scale linearly for 0, 1, 2, 5', () => {
  const candidate = qCandidate();
  const maxLoss = num(candidate.economics.maxLoss, 'maxLoss must be known');
  const maxProfit = num(candidate.economics.maxProfit, 'maxProfit must be known');
  const collateral = num(candidate.economics.collateral, 'collateral must be known');
  for (const quantity of [0, 1, 2, 5]) {
    const position = computeCandidatePositionEconomics(candidate, quantity);
    assert.equal(position.validity, 'VALID');
    assert.equal(position.positionMaxLoss, maxLoss * quantity);
    assert.equal(position.positionMaxProfit, maxProfit * quantity);
    assert.equal(position.positionCollateral, collateral * quantity);
    // break-even and the rate must never scale
    assert.equal(position.breakEvenPerShare, candidate.economics.breakEven);
    assert.equal(position.capitalDayYieldRate, candidate.economics.capitalDayYield);
  }
});

test('PROPERTY: doubling quantity doubles position max loss/profit/collateral, never changes break-even', () => {
  const candidate = qCandidate();
  const one = computeCandidatePositionEconomics(candidate, 1);
  const two = computeCandidatePositionEconomics(candidate, 2);
  assert.equal(two.positionMaxLoss, num(one.positionMaxLoss, 'one.positionMaxLoss must be known') * 2);
  assert.equal(two.positionMaxProfit, num(one.positionMaxProfit, 'one.positionMaxProfit must be known') * 2);
  assert.equal(two.positionCollateral, num(one.positionCollateral, 'one.positionCollateral must be known') * 2);
  assert.equal(two.breakEvenPerShare, one.breakEvenPerShare);
});

test('quantity=0 produces a real zero position, not a null-shaped "no trade exists" ambiguity, and per-contract fields remain untouched', () => {
  const candidate = qCandidate();
  const position = computeCandidatePositionEconomics(candidate, 0);
  assert.equal(position.positionMaxLoss, 0);
  assert.equal(position.positionMaxProfit, 0);
  assert.equal(position.positionCollateral, 0);
  assert.equal(position.perContract.maxLoss, candidate.economics.maxLoss, 'per-contract economics must be unchanged at quantity=0');
});

test('INVALID QUANTITY: negative, non-integer, NaN, and Infinity all fail safely, never silently rounded or coerced', () => {
  const candidate = qCandidate();
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity]) {
    const position = computeCandidatePositionEconomics(candidate, bad);
    assert.equal(position.validity, 'INVALID_QUANTITY');
    assert.ok(position.invalidReason !== null);
    assert.equal(position.positionMaxLoss, null);
    assert.equal(position.positionMaxProfit, null);
    assert.equal(position.positionCollateral, null);
  }
});

test('an UNKNOWN per-contract value (e.g. no quote) can never produce a known position total', () => {
  const c = contract({ bid: null, ask: null });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_Q']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  const position = computeCandidatePositionEconomics(candidate, 3);
  assert.equal(position.positionMaxLoss, null, 'maxLoss depends on premium, which is unknown here');
  assert.equal(position.positionMaxProfit, null, 'maxProfit depends on premium, which is unknown here');
  // collateral (strike*multiplier) is independent of the quote and remains
  // known and correctly scaled even when premium is not -- proving this
  // module never conflates "one field unknown" with "everything unknown."
  assert.equal(position.positionCollateral, 190 * 100 * 3);
});

test('NUMERICAL SAFETY: no NaN/Infinity enters position economics for any quantity in the matrix', () => {
  const candidate = qCandidate();
  for (const quantity of [0, 1, 2, 5]) {
    const position = computeCandidatePositionEconomics(candidate, quantity);
    for (const [key, value] of Object.entries(position)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must be finite for quantity=${quantity}, got ${value}`);
    }
  }
});

test('ASSIGNMENT ENTRY EXPOSURE: standard multiplier -- assigned shares, cash requirement, and effective basis are all real and match breakEven', () => {
  const candidate = qCandidate();
  const exposure = computeShortPutAssignmentEntryExposure({ strike: 190, premiumPerShare: 2, multiplier: 100, quantity: 2 });
  assert.equal(exposure.validity, 'VALID');
  assert.equal(exposure.assignedShareCount, 200);
  assert.equal(exposure.assignmentCashRequirement, 190 * 100 * 2);
  assert.equal(exposure.effectiveAssignedBasisPerShare, 188);
  assert.equal(exposure.effectiveAssignedBasisPerShare, candidate.economics.breakEven, 'effective assigned basis must equal the candidate\'s own breakEven -- documented relationship, not a duplicate formula');
});

test('ASSIGNMENT ENTRY EXPOSURE: a nonstandard known multiplier scales correctly, never assumed 100', () => {
  const exposure = computeShortPutAssignmentEntryExposure({ strike: 190, premiumPerShare: 2, multiplier: 10, quantity: 1 });
  assert.equal(exposure.assignedShareCount, 10);
  assert.equal(exposure.assignmentCashRequirement, 1900);
});

test('ASSIGNMENT ENTRY EXPOSURE: an ADJUSTED or UNKNOWN deliverable must fail closed, never apply the naive share-count formula', () => {
  for (const deliverableClassification of ['ADJUSTED', 'UNKNOWN'] as const) {
    const exposure = computeShortPutAssignmentEntryExposure({ strike: 190, premiumPerShare: 2, multiplier: 100, quantity: 1, deliverableClassification });
    assert.equal(exposure.validity, 'UNKNOWN_MULTIPLIER');
    assert.equal(exposure.assignedShareCount, null);
    assert.equal(exposure.assignmentCashRequirement, null);
  }
});

test('D (defined-risk) position totals scale by quantity identically to Q -- net credit/max profit/max loss/collateral scale, width/breakEven do not', () => {
  const shortPut = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2, ask: 2.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, bid: 0.6, ask: 0.7 });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [shortPut, longPut], routing: routing(['THETA_D']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates.find((c) => c.legs.length === 2);
  assert.ok(candidate);
  const one = computeCandidatePositionEconomics(candidate, 1);
  const three = computeCandidatePositionEconomics(candidate, 3);
  assert.equal(three.positionMaxLoss, num(one.positionMaxLoss, 'D one.positionMaxLoss must be known') * 3);
  assert.equal(three.positionMaxProfit, num(one.positionMaxProfit, 'D one.positionMaxProfit must be known') * 3);
  assert.equal(three.positionCollateral, num(one.positionCollateral, 'D one.positionCollateral must be known') * 3);
  assert.equal(three.breakEvenPerShare, one.breakEvenPerShare);
});

test('H (Hold-Strike, same short-put payoff structure as Q, different DTE lattice) position totals scale identically', () => {
  const c = contract({ optionSymbol: 'AAPL260917P00190000', occSymbol: 'AAPL260917P00190000', strike: 190, bid: 0.3, ask: 0.4, expiration: '2026-09-17' });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_H']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_HOLD_STRIKE')?.candidates[0];
  assert.ok(candidate);
  const one = computeCandidatePositionEconomics(candidate, 1);
  const four = computeCandidatePositionEconomics(candidate, 4);
  assert.equal(four.positionMaxLoss, num(one.positionMaxLoss, 'H one.positionMaxLoss must be known') * 4);
  assert.equal(four.breakEvenPerShare, one.breakEvenPerShare);
});

test('ASSIGNMENT ENTRY EXPOSURE: invalid quantity fails closed, distinct from the multiplier failure', () => {
  const exposure = computeShortPutAssignmentEntryExposure({ strike: 190, premiumPerShare: 2, multiplier: 100, quantity: -1 });
  assert.equal(exposure.validity, 'INVALID_QUANTITY');
  assert.equal(exposure.assignedShareCount, null);
});
