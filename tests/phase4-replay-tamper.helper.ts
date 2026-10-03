// Shared fixture for tests/phase4-replay-tamper.test.ts and the fresh-process determinism check (not collected as a test).
import { createHash } from 'node:crypto';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

const NOW = '2026-09-14T15:00:00.000Z';
const contract = (strike: number, overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract => {
  const symbol = `AAPL261016P${String(strike * 1000).padStart(8, '0')}`;
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW, bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01,
    theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30,
    maxSpreadPctForExecutable: 0.2, ...overrides }, NOW);
};
const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q', eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'tamper' }], policyVersion: 'router-v1' })) });
export const input: CanonicalStrategyFrontierInput = { snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', contracts: [contract(190), contract(185, { bid: 1.4, ask: 1.5 }), contract(180, { bid: 0.9, ask: 1.0 })],
  routing, stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL', buyingPower: 100_000, eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' }, brokerAllowedQty: 3,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 } };

/** the decision-relevant fingerprint of a frontier */
export const decision = (frontier: ReturnType<typeof buildCanonicalStrategyFrontier>) => JSON.stringify({
  hash: frontier.contentHash, selected: frontier.selectedCandidateId, branch: frontier.selectedBranch, action: frontier.primaryAction, qty: frontier.selectedQuantity,
  wait: frontier.globalWaitEarned, waitReasons: frontier.globalWaitReasons,
  candidates: frontier.branches.flatMap((branch) => branch.candidates.map((candidate) => [candidate.candidateId, candidate.aegisState, candidate.sizing.quantity, candidate.sizing.bindingConstraint, candidate.hardBlockers, candidate.riskFeasible, candidate.paretoRank])) });


export function fingerprint(): string {
  return createHash('sha256').update(decision(buildCanonicalStrategyFrontier(input))).digest('hex');
}
