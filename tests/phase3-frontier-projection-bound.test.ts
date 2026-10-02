import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { boundedProjectionSampleSize, projectCanonicalFrontierForPostgres } from '../src/theta/postgres-cycle-evidence-storage.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// 2026-10-02 production incident: on a full SPY chain the per-candidate lists of the adaptive shadow comparison pushed the
// queryable frontier projection past the 768 KiB inline bound. Every evidence cycle failed with
// CANONICAL_FRONTIER_POLICY_PAYLOAD_TOO_LARGE (809 KB - 1.02 MB), nothing was persisted and the worker returned HTTP 503 all
// session. The projection must be bounded independent of the chain size, and its truncation must be explicit and provable.

const NOW = '2026-09-14T15:00:00.000Z';
const dates = ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'];
const osi = (expiration: string, strike: number): string =>
  `SYN${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}P${String(Math.round(strike * 1000)).padStart(8, '0')}`;

function makeContracts(count: number): NormalizedOptionContract[] {
  const out: NormalizedOptionContract[] = [];
  let seed = 12345;
  const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < count; i += 1) {
    const expiration = dates[i % dates.length] as string;
    const strike = 50 + Math.floor(i / dates.length) * 0.5;
    const symbol = osi(expiration, strike);
    const bid = Math.max(0.05, Math.round(rand() * 400) / 100);
    out.push(normalizeOptionContract({
      source: 'ALPACA', underlying: 'SYN', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike, expiration,
      asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200,
      underlyingTimestamp: NOW, bid, ask: bid + 0.05 + rand() * 0.1, bidSize: 20, askSize: 18, lastTradePrice: bid, lastTradeSize: 1,
      quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 10 + Math.floor(rand() * 500), volumeSource: 'ALPACA',
      openInterest: 50 + Math.floor(rand() * 2000), openInterestSource: 'OPTIONOMICS', iv: 0.2 + rand() * 0.3,
      delta: -(0.05 + rand() * 0.4), gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW,
      greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30,
      maxSpreadPctForExecutable: 0.5,
    }, NOW));
  }
  return out;
}

const families: StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
const routing = (eligible: readonly StrategyFamily[]) => parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: families.map((strategyFamily) => ({
    strategyFamily, eligible: eligible.includes(strategyFamily),
    eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'projection' }], policyVersion: 'router-v1' })),
});
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null,
  assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3,
    tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' } as const,
};
const frontierFor = (count: number) => buildCanonicalStrategyFrontier({ ...base, contracts: makeContracts(count),
  routing: routing(['THETA_Q', 'THETA_H', 'THETA_D', 'THETA_A', 'THETA_C']) } as never);

interface BoundedList { count: number; truncated: boolean; fullListHash: string; entries: unknown[]; reasonCounts?: Record<string, number>;
  riskFeasibleCount?: number; positiveSizedCount?: number }
const shadowOf = (projection: unknown) => (projection as { adaptiveShadowDecision: { shadowComparison: {
  excluded: BoundedList; candidateEligibility: BoundedList } } }).adaptiveShadowDecision.shadowComparison;
const sha = (value: unknown): string => createHash('sha256').update(canonicalJson(value as never)).digest('hex');

test('the Postgres frontier projection stays bounded at 300 / 2619 / 5000 contracts and never exceeds the inline policy', () => {
  const sizes: number[] = [];
  for (const count of [300, 2619, 5000]) {
    const { projection } = projectCanonicalFrontierForPostgres(frontierFor(count));
    const bytes = Buffer.byteLength(canonicalJson(projection as never));
    assert.ok(bytes < 128 * 1024, `${count} contracts projected to ${bytes} bytes`);
    sizes.push(bytes);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 4096, `projection size must not scale with the chain: ${sizes.join(',')}`);
});

test('truncation is explicit and exact: counts, per-reason counts and a hash of the complete list are preserved', () => {
  const frontier = frontierFor(2619);
  const full = frontier.adaptiveShadowDecision?.shadowComparison;
  assert.ok(full);
  assert.ok(full.excluded.length > boundedProjectionSampleSize && full.candidateEligibility.length > boundedProjectionSampleSize);
  const projected = shadowOf(projectCanonicalFrontierForPostgres(frontier).projection);

  assert.equal(projected.excluded.count, full.excluded.length);
  assert.equal(projected.excluded.truncated, true);
  assert.equal(projected.excluded.entries.length, boundedProjectionSampleSize);
  assert.equal(projected.excluded.fullListHash, sha(full.excluded));
  const reasonTotal = Object.values(projected.excluded.reasonCounts ?? {}).reduce((a, b) => a + b, 0);
  assert.equal(reasonTotal, full.excluded.reduce((sum, entry) => sum + entry.reasons.length, 0), 'every excluded reason is counted');

  assert.equal(projected.candidateEligibility.count, full.candidateEligibility.length);
  assert.equal(projected.candidateEligibility.truncated, true);
  assert.equal(projected.candidateEligibility.fullListHash, sha(full.candidateEligibility));
  assert.equal(projected.candidateEligibility.riskFeasibleCount, full.candidateEligibility.filter((entry) => entry.riskFeasible).length);
  assert.equal(projected.candidateEligibility.positiveSizedCount,
    full.candidateEligibility.filter((entry) => (entry.actualSizedQuantity ?? 0) > 0).length);
});

test('a short list is not marked truncated and keeps every entry', () => {
  const frontier = frontierFor(10);
  const full = frontier.adaptiveShadowDecision?.shadowComparison;
  assert.ok(full);
  const projected = shadowOf(projectCanonicalFrontierForPostgres(frontier).projection);
  assert.equal(projected.candidateEligibility.truncated, full.candidateEligibility.length > boundedProjectionSampleSize);
  assert.equal(projected.candidateEligibility.entries.length, Math.min(full.candidateEligibility.length, boundedProjectionSampleSize));
});
