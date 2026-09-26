import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 3: THETA-Q-CSP-MAXLOSS-NOT-POPULATED. Reproduced test-first against
// pre-fix source (captured real output: economics.maxLoss === null despite
// known strike/credit/multiplier), then fixed in
// canonical-strategy-frontier.ts's singleLegPutCandidate(). This function is
// shared by THETA_CONVENTIONAL (Q) and THETA_HOLD_STRIKE (H), so this same
// fix and this same test matrix covers both branches (directive section 10:
// "If H is economically the same short-put payoff structure as Q... reuse
// canonical payoff helper" -- confirmed true by source read, not assumed).

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

function qCandidate(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}) {
  const c = contract(overrides);
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_Q']) });
  return frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
}

function hCandidate(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}) {
  const c = contract(overrides);
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_H']) });
  return frontier.branches.find((b) => b.branch === 'THETA_HOLD_STRIKE')?.candidates[0];
}

test('CORE CLAIM (Q max loss): strike=190, credit=2, multiplier=100 -> maxLoss = (190-2)*100 = 18800, not null', () => {
  const candidate = qCandidate();
  assert.ok(candidate);
  assert.equal(candidate.economics.maxProfit, 200);
  assert.equal(candidate.economics.maxLoss, 18800);
  // Independent formula verifier (directive item 49): maxLoss + maxProfit
  // must equal the full collateral, since a cash-secured put's worst case
  // is "keep the premium, lose the rest of the collateral down to zero."
  const maxLoss = num(candidate.economics.maxLoss, 'maxLoss must be known');
  const maxProfit = num(candidate.economics.maxProfit, 'maxProfit must be known');
  assert.equal(maxLoss + maxProfit, candidate.economics.collateral);
});

test('H reuses the identical formula (same payoff structure, different DTE policy)', () => {
  // H's lattice is 2-5 DTE (strategy-package.ts); asOf=2026-09-14, so expiration
  // must fall inside that window -- 2026-09-17 is 3 DTE.
  const candidate = hCandidate({ optionSymbol: 'AAPL260917P00190000', occSymbol: 'AAPL260917P00190000', expiration: '2026-09-17' });
  assert.ok(candidate);
  assert.equal(candidate.dte, 3);
  assert.equal(candidate.economics.maxLoss, 18800);
});

test('quantity=1 sizing does not change per-contract maxLoss (per-contract vs position-total stay distinct)', () => {
  const candidate = qCandidate();
  assert.ok(candidate);
  // economics.maxLoss is per-contract; sizing.quantity is separate and must
  // not have been silently multiplied in.
  assert.equal(candidate.economics.maxLoss, 18800);
  assert.ok(typeof candidate.sizing.quantity === 'number');
});

test('a non-standard known multiplier (e.g. 10, an adjusted contract) scales maxLoss correctly, never assumed 100', () => {
  const candidate = qCandidate({ multiplier: 10, occSymbol: null });
  assert.ok(candidate);
  assert.equal(candidate.economics.maxLoss, (190 - 2) * 10);
  assert.notEqual(candidate.economics.maxLoss, (190 - 2) * 100);
});

test('a very small credit still produces a real, large maxLoss close to full collateral', () => {
  const candidate = qCandidate({ bid: 0.01, ask: 0.05 });
  assert.ok(candidate);
  assert.equal(candidate.economics.maxLoss, (190 - 0.01) * 100);
  const maxLoss = num(candidate.economics.maxLoss, 'maxLoss must be known');
  const collateral = num(candidate.economics.collateral, 'collateral must be known');
  assert.ok(maxLoss > collateral * 0.99);
});

test('credit=0 (zero bid, a real value, not missing data) produces maxLoss exactly equal to collateral', () => {
  const candidate = qCandidate({ bid: 0, ask: 0.05 });
  assert.ok(candidate);
  assert.equal(candidate.economics.maxProfit, 0);
  assert.equal(candidate.economics.maxLoss, 190 * 100);
});

test('an unavailable quote (null bid) keeps maxLoss honestly null -- never fabricated from strike alone', () => {
  const candidate = qCandidate({ bid: null, ask: null });
  assert.ok(candidate);
  assert.equal(candidate.economics.premiumPerShare, null);
  assert.equal(candidate.economics.maxLoss, null);
  assert.equal(candidate.economics.maxProfit, null);
});

test('a stale (non-executable) quote still exposes the structural maxLoss -- structural comparison and execution qualification are separate stages, and a stale bid is still a real known number', () => {
  const candidate = qCandidate({ dataQuality: 'STALE' });
  assert.ok(candidate);
  assert.equal(candidate.executionAuthorized, false);
  assert.equal(candidate.economics.maxLoss, 18800, 'the structural economics must not be hidden just because execution is not authorized this quote');
});

test('PROPERTY: Q maxProfit >= 0 for valid positive credit', () => {
  const candidate = qCandidate({ bid: 3.5, ask: 3.6 });
  assert.ok(candidate);
  assert.ok(num(candidate.economics.maxProfit, 'maxProfit must be known') >= 0);
});

test('PROPERTY: Q maxLoss >= 0', () => {
  for (const bid of [0, 0.01, 1, 5, 10]) {
    const candidate = qCandidate({ bid, ask: bid + 0.05 });
    assert.ok(candidate);
    assert.ok(num(candidate.economics.maxLoss, 'maxLoss must be known') >= 0, `maxLoss must be non-negative for bid=${bid}`);
  }
});

test('PROPERTY: higher entry credit moves break-even lower, all else equal', () => {
  const lowCredit = qCandidate({ bid: 1, ask: 1.1 });
  const highCredit = qCandidate({ bid: 3, ask: 3.1 });
  assert.ok(lowCredit && highCredit);
  const lowBreakEven = num(lowCredit.economics.breakEven, 'lowCredit breakEven must be known');
  const highBreakEven = num(highCredit.economics.breakEven, 'highCredit breakEven must be known');
  assert.ok(highBreakEven < lowBreakEven);
});

test('PROPERTY: higher entry credit lowers contractual max loss (more premium retained against the same collateral), all else equal', () => {
  const lowCredit = qCandidate({ bid: 1, ask: 1.1 });
  const highCredit = qCandidate({ bid: 3, ask: 3.1 });
  assert.ok(lowCredit && highCredit);
  const lowMaxLoss = num(lowCredit.economics.maxLoss, 'lowCredit maxLoss must be known');
  const highMaxLoss = num(highCredit.economics.maxLoss, 'highCredit maxLoss must be known');
  assert.ok(highMaxLoss < lowMaxLoss);
});

test('PROPERTY: higher strike increases contractual max downside, all else equal', () => {
  const lowerStrike = qCandidate({ strike: 180, optionSymbol: 'AAPL261016P00180000' });
  const higherStrike = qCandidate({ strike: 195, optionSymbol: 'AAPL261016P00195000' });
  assert.ok(lowerStrike && higherStrike);
  const lowerMaxLoss = num(lowerStrike.economics.maxLoss, 'lowerStrike maxLoss must be known');
  const higherMaxLoss = num(higherStrike.economics.maxLoss, 'higherStrike maxLoss must be known');
  assert.ok(higherMaxLoss > lowerMaxLoss);
});

test('CAPITAL_DAY_YIELD vs GROSS_RETURN_ON_COLLATERAL (Phase 3 Final Closure B): two distinct, never-conflated concepts -- one is a rate per day, the other is dimensionless with no time basis', () => {
  const candidate = qCandidate();
  const grossReturnOnCollateral = num(candidate.economics.grossReturnOnCollateral, 'grossReturnOnCollateral must be known');
  const capitalDayYield = num(candidate.economics.capitalDayYield, 'capitalDayYield must be known');
  const maxProfit = num(candidate.economics.maxProfit, 'maxProfit must be known');
  const collateral = num(candidate.economics.collateral, 'collateral must be known');
  // grossReturnOnCollateral = grossPremium / collateral, no time dimension.
  assert.equal(grossReturnOnCollateral, maxProfit / collateral);
  // capitalDayYield divides that same ratio further by dte -- strictly
  // smaller whenever dte > 1, proving they are not secretly the same number.
  assert.ok(candidate.dte !== null && candidate.dte > 1);
  assert.ok(capitalDayYield < grossReturnOnCollateral);
  assert.equal(capitalDayYield, grossReturnOnCollateral / (candidate.dte as number));
});

test('NUMERICAL SAFETY: no NaN or Infinity enters the canonical economics for any of the above fixtures', () => {
  for (const candidate of [qCandidate(), qCandidate({ bid: 0 }), qCandidate({ multiplier: 10, occSymbol: null }), qCandidate({ bid: null, ask: null })]) {
    assert.ok(candidate);
    for (const [key, value] of Object.entries(candidate.economics)) {
      if (typeof value === 'number') {
        assert.ok(Number.isFinite(value), `economics.${key} must be finite, got ${value}`);
      }
    }
  }
});
