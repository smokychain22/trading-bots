import { performance } from 'node:perf_hooks';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

// Offline, deterministic synthetic stress. This does not imply candidate
// quality, broker availability, or profitability. No provider or DB calls.
const count = Number(process.argv[2] ?? 2_601);
if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error('COUNT_MUST_BE_1_TO_10000');
const now = '2026-09-30T15:00:00.000Z';
const contracts = Array.from({ length: count }, (_, index) => {
  const strike = 100 + index / 100;
  const symbol = `SPY261030P${String(Math.round(strike * 1000)).padStart(8, '0')}`;
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: symbol, occSymbol: symbol,
    optionType: 'PUT', strike, expiration: '2026-10-30', asOfDate: '2026-09-30', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: now,
    bid: 1, ask: 1.05, bidSize: 20, askSize: 18, lastTradePrice: 1.02, lastTradeSize: 1,
    quoteTimestamp: now, tradeTimestamp: now, volume: 250, volumeSource: 'ALPACA',
    openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22,
    gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: now,
    greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, now);
});
const families = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const;
const routing = parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'perf-snapshot', timestamp: now,
  policyVersion: 'perf-probe-v1', results: families.map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'PERFORMANCE_PROBE', polarity: 0, detail: 'synthetic' }], policyVersion: 'perf-probe-v1',
  })),
});
const started = performance.now();
const frontier = buildCanonicalStrategyFrontier({
  snapshotId: 'perf-snapshot', timestamp: now, strategyVersion: 'perf-probe-v1', contracts,
  routing, stock: null, assignmentCapacityQty: 100, buyingPower: 1_000_000,
  brokerAllowedQty: 100, sizingPolicy: { riskBudgetQtyCap: 100, collateralQtyCap: 100,
    concentrationQtyCap: 100, assignmentCapacityQtyCap: 100, tailRiskQtyCap: 100,
    correlationQtyCap: 100, liquidityQtyCap: 100, reducedStateMultiplier: 0.5 },
  aegisNewRiskState: 'ALLOW_FULL', eventState: 'CLEAR', unmanagedBrokerPositionCount: 0,
  unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'RESEARCH_ONLY' },
});
const elapsedMs = Math.round(performance.now() - started);
const q = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
const d = frontier.branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK');
console.log(JSON.stringify({ contractVersion: 'theta-brain-performance-probe-v1', synthetic: true,
  contractCount: count, elapsedMs, qCandidates: q?.candidateCount ?? null,
  dCandidates: d?.candidateCount ?? null, dTruncated: d?.enumerationTruncated ?? null,
  dominanceReferences: frontier.branches.reduce((sum, branch) => sum + branch.candidates.reduce(
    (candidateSum, candidate) => candidateSum + candidate.dominatedBy.length, 0), 0),
  dominanceOmitted: frontier.branches.reduce((sum, branch) => sum + branch.candidates.reduce(
    (candidateSum, candidate) => candidateSum + (candidate.dominatedByOmittedCount ?? 0), 0), 0),
  maximumParetoRank: frontier.branches.reduce((maximum, branch) => Math.max(maximum,
    ...branch.candidates.map((candidate) => candidate.paretoRank ?? 0)), 0),
  heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  brokerMutations: 0 }));
