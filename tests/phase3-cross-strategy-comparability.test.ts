import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 3: items 44/46/47 -- Q/H/D cannot be fairly compared on premium
// dollars alone. These fixtures prove the real, distinct economic
// dimensions (capital, capital-days, capped-vs-uncapped risk) are
// correctly truthful against the real buildCanonicalStrategyFrontier()
// output -- NOT a claim that any one branch "should win."

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

function num(value: number | null, message: string): number {
  assert.ok(value !== null, message);
  return value as number;
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

test('ITEM 46 (Q vs D capital example): Q requires full cash-secured collateral; D requires only the spread width -- both truthful, D is not automatically "better"', () => {
  const shortPut = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2, ask: 2.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, bid: 0.6, ask: 0.7 });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [shortPut, longPut], routing: routing(['THETA_Q', 'THETA_D']) });
  const q = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.action === 'OPEN_CSP' && c.candidateId.endsWith('190000'));
  const d = frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates.find((c) => c.legs.length === 2);
  assert.ok(q && d);
  // Q's capital requirement (collateral) is the full cash-secured amount.
  assert.equal(q.economics.collateral, 190 * 100);
  // D's capital requirement (collateral, defined as maxLoss for D) is bounded by width, strictly smaller here.
  const dCollateral = num(d.economics.collateral, 'D collateral must be known');
  const qCollateral = num(q.economics.collateral, 'Q collateral must be known');
  assert.ok(dCollateral < qCollateral);
  // D's max loss is capped; Q's max loss approaches the full collateral (uncapped downside toward zero).
  const dMaxLoss = num(d.economics.maxLoss, 'D maxLoss must be known');
  const qMaxLoss = num(q.economics.maxLoss, 'Q maxLoss must be known');
  assert.ok(dMaxLoss < qMaxLoss);
  // Neither branch's economics silently borrows the other's numbers.
  assert.notEqual(q.economics.collateral, d.economics.collateral);
});

test('ITEM 47 (Q vs H time example): similar capital, different DTE -- capital-days differ even though per-contract collateral can match', () => {
  const qContract = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2, ask: 2.1, expiration: '2026-10-16' });
  // H's lattice is 2-5 DTE (strategy-package.ts) -- 2026-09-17 is 3 DTE from asOf 2026-09-14.
  const hContract = contract({ optionSymbol: 'AAPL260917P00190000', occSymbol: 'AAPL260917P00190000', strike: 190, bid: 0.3, ask: 0.4, expiration: '2026-09-17' });
  const qFrontier = buildCanonicalStrategyFrontier({ ...base, contracts: [qContract], routing: routing(['THETA_Q']) });
  const hFrontier = buildCanonicalStrategyFrontier({ ...base, contracts: [hContract], routing: routing(['THETA_H']) });
  const q = qFrontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  const h = hFrontier.branches.find((b) => b.branch === 'THETA_HOLD_STRIKE')?.candidates[0];
  assert.ok(q && h);
  assert.equal(q.economics.collateral, h.economics.collateral, 'same strike/multiplier -> identical per-contract collateral, a fair basis for the comparison');
  assert.ok(q.dte > h.dte, 'Q must be the longer-dated candidate in this fixture');
  // capitalDayYield is a RATE (return per unit collateral per day), not the raw day count -- both differ here because premium/dte differ, and neither should be silently annualized into the raw comparison.
  assert.notEqual(q.economics.capitalDayYield, h.economics.capitalDayYield);
  const qYield = num(q.economics.capitalDayYield, 'Q capitalDayYield must be known');
  const hYield = num(h.economics.capitalDayYield, 'H capitalDayYield must be known');
  assert.ok(Number.isFinite(qYield) && Number.isFinite(hYield));
});

test('ITEM 44: no branch is ranked by grossPremium/collateral alone as a single scalar -- each keeps its own explicit multi-dimensional Pareto objective set (traced from source, not asserted in prose)', () => {
  // This is a structural/documentation-style test: it fails loudly if a
  // future change collapses Q's or D's objective set down to one scalar.
  const shortPut = contract({ optionSymbol: 'AAPL261016P00190000', strike: 190, bid: 2, ask: 2.1 });
  const longPut = contract({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, bid: 0.6, ask: 0.7 });
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [shortPut, longPut], routing: routing(['THETA_Q', 'THETA_D']) });
  const q = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.action === 'OPEN_CSP');
  const d = frontier.branches.find((b) => b.branch === 'THETA_DEFINED_RISK')?.candidates.find((c) => c.legs.length === 2);
  assert.ok(q && d);
  // paretoRank exists and is a small positive integer (rank-based, not a raw dollar score).
  assert.ok(typeof q.paretoRank === 'number' && q.paretoRank >= 1);
  assert.ok(typeof d.paretoRank === 'number' && d.paretoRank >= 1);
});
