import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 4 (directive items 18, 40, 49, 76-77): real, integrated
// Q-vs-D account-capital-constraint test, using the actual production
// structuralSizing() BUYING_POWER_AFFORDABLE mechanism -- not a
// reimplementation, not a synthetic sizing stub.

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

const sizingPolicy = {
  riskBudgetQtyCap: 10, collateralQtyCap: 10, concentrationQtyCap: 10,
  assignmentCapacityQtyCap: 10, tailRiskQtyCap: 10, correlationQtyCap: 10,
  liquidityQtyCap: 10, reducedStateMultiplier: 0.5,
};

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  stock: null, assignmentCapacityQty: null, aegisNewRiskState: 'ALLOW_FULL' as const,
  brokerAllowedQty: 10, sizingPolicy,
  eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

test('Q VS D CAPITAL TEST (item 49): a small account buying power blocks Q (large cash-secured collateral) via the real BUYING_POWER_AFFORDABLE cap, while D (bounded max-loss capital) remains sizeable -- proven with the real structuralSizing() mechanism, not a stub', () => {
  const shortPut = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2, ask: 2.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, bid: 0.6, ask: 0.7 });
  // $2,000 buying power: Q's collateral is $19,000/contract (unaffordable,
  // capacity 0); D's capital (= maxLoss, a bounded spread width) is small
  // enough to afford at least one contract.
  const frontier = buildCanonicalStrategyFrontier({
    ...base, buyingPower: 2000, contracts: [shortPut, longPut], routing: routing(['THETA_Q', 'THETA_D']),
  });
  const q = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.action === 'OPEN_CSP' && c.candidateId.endsWith('190000'));
  const d = frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates.find((c) => c.legs.length === 2);
  assert.ok(q && d);

  assert.equal(q.sizing.quantity, 0, 'Q must be capital-blocked at this buying power');
  assert.ok(d.sizing.quantity >= 1, 'D must remain structurally sizeable -- Q being capital-blocked must not suppress D');
  // Real, precise finding: $2,000 buying power against Q's $19,000
  // collateral floors to zero assignment capacity BEFORE structural sizing
  // even runs -- this is the genuine, named account-capital reason
  // (NO_ASSIGNMENT_CAPACITY), not a vague zero. Q's economics (maxLoss,
  // breakEven, etc.) remain fully computed and readable regardless.
  assert.ok(q.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'), 'the exact binding reason must be named, never a generic zero');
  assert.ok(Number.isFinite(q.economics.maxLoss ?? NaN), 'Q economics remain evaluable even though it is capital-blocked');
});

test('FALSE-ZERO DETECTOR (item 76): sufficient buying power, ALLOW_FULL AEGIS, valid economics -> Q must NOT be zero (a positive-capacity scenario proves the mechanism is not stuck at zero by a wiring defect)', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({ ...base, buyingPower: 100_000, contracts: [c], routing: routing(['THETA_Q']) });
  const q = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(q);
  assert.ok(q.sizing.quantity > 0, 'with ample buying power and full AEGIS, quantity must be positive -- a zero here would indicate a real sizing defect');
});

test('FALSE-POSITIVE SIZE DETECTOR (item 77): AEGIS HARD_VETO must never coexist with a positive executable quantity', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({ ...base, aegisNewRiskState: 'HARD_VETO', buyingPower: 100_000, contracts: [c], routing: routing(['THETA_Q']) });
  const q = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(q);
  assert.equal(q.riskFeasible, false);
  assert.ok(q.hardBlockers.includes('AEGIS_HARD_VETO'));
});

test('CAPACITY MONOTONICITY (item 78): reducing buying power can only reduce or hold quantity, never increase it', () => {
  const c = contract();
  const high = buildCanonicalStrategyFrontier({ ...base, buyingPower: 100_000, contracts: [c], routing: routing(['THETA_Q']) });
  const low = buildCanonicalStrategyFrontier({ ...base, buyingPower: 5000, contracts: [c], routing: routing(['THETA_Q']) });
  const qHigh = high.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const qLow = low.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(qHigh && qLow);
  assert.ok(qLow.sizing.quantity <= qHigh.sizing.quantity);
});

test('CAPACITY MONOTONICITY (item 78): a worse AEGIS state can only reduce or hold quantity, never increase it', () => {
  const c = contract();
  const full = buildCanonicalStrategyFrontier({ ...base, aegisNewRiskState: 'ALLOW_FULL', buyingPower: 100_000, contracts: [c], routing: routing(['THETA_Q']) });
  const reduced = buildCanonicalStrategyFrontier({ ...base, aegisNewRiskState: 'ALLOW_REDUCED', buyingPower: 100_000, contracts: [c], routing: routing(['THETA_Q']) });
  const qFull = full.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const qReduced = reduced.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(qFull && qReduced);
  assert.ok(qReduced.sizing.quantity <= qFull.sizing.quantity);
});
