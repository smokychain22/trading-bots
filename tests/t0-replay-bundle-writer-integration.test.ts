import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildFusionSnapshot, type FusionSnapshotInput } from '../src/market/fusion-snapshot.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import type { CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import {
  decodeCycleEvidenceArchive,
  projectCycleEvidenceForPostgres,
} from '../src/theta/postgres-cycle-evidence-storage.js';
import { buildT0ReplayBundle, replayFromT0Bundle, t0ReplayBundleSchema } from '../src/theta/t0-replay-bundle.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';
import { classifyMethodInputProvenance, type MethodInputProvenance } from '../src/theta/profitability-method-input-provenance.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (item 6): this proves
// ACTUAL writer integration, not merely buildT0ReplayBundle() called in
// isolation. Real path: a realistic canonical input -> the real Postgres
// evidence writer (projectCycleEvidenceForPostgres, the same function
// PostgresThetaCycleStore.persist() calls) -> decode the archive back ->
// extract the SAME canonicalFrontierInput field the writer stored -> feed
// it through replayFromT0Bundle() -> compare against the original
// selection facts.
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const now = '2026-09-25T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261016P00650000', occSymbol: 'SPY261016P00650000',
    optionType: 'PUT', strike: 650, expiration: '2026-10-16', asOfDate: '2026-09-25', multiplier: 100,
    underlyingBid: 665, underlyingAsk: 665.02, underlyingLast: 665.01, underlyingTimestamp: now,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: now, tradeTimestamp: now, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: now, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, now);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: now, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const realCanonicalFrontierInput: CanonicalStrategyFrontierInput = {
  snapshotId: 'snap-1', timestamp: now, strategyVersion: 'theta-strategy-package-v1',
  contracts: [contract()], routing: routing(['THETA_Q']),
  stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL',
  buyingPower: 100_000, eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' },
};

function realisticCycle(): ThetaShadowCycleResult {
  const input: FusionSnapshotInput = {
    botId: 'THETA', decisionTimeUtc: now, triggerType: 'TEST', marketSession: { isOpen: true },
    underlyingState: { symbol: 'SPY', last: 665.01 }, contractCandidates: [contract()],
    accountState: { status: 'ACTIVE' }, positionState: { positions: [], orders: [] }, portfolioExposure: {},
    alpacaQuoteState: null,
    optionomicsFeatureState: { schemaVersion: 'test-v1', contracts: [contract()], unavailableFamilies: [] },
    eventState: { state: 'CLEAR' }, regimeState: { companyEventByOptionSymbol: {} }, expertPriorState: null,
    riskState: { alpacaContractIvStress: { assessmentsByContract: {} } }, strategyRouterState: null,
    versions: { strategyVersion: 'test', featureVersion: 'test', riskLimitVersion: 'test', executionVersion: 'test',
      costModelVersion: 'test', dataVersion: 'test', modelVersions: {} },
    sourceProvenance: [
      { provider: 'ALPACA', operationAlias: 'account', asOf: now, retrievedAt: now,
        state: 'GOOD', contentHash: sha('account'), feed: null, contractVersion: 'v2', truthRole: 'ACCOUNT', requiredForNewRisk: true },
      { provider: 'ALPACA', operationAlias: 'contracts', asOf: now, retrievedAt: now,
        state: 'GOOD', contentHash: sha('contracts'), feed: null, contractVersion: 'v2', truthRole: 'CONTRACT', requiredForNewRisk: true },
      { provider: 'ALPACA', operationAlias: 'quotes', asOf: now, retrievedAt: now,
        state: 'GOOD', contentHash: sha('quotes'), feed: 'OPRA', contractVersion: 'v1', truthRole: 'QUOTE', requiredForNewRisk: true },
    ],
    providerHealth: [{ provider: 'ALPACA', state: 'GOOD', asOf: now, retrievedAt: now }],
    freshnessFlags: [], unknownFeatures: [], executableTruth: { account: 'GOOD', contract: 'GOOD', quote: 'GOOD' },
  };
  const fusionSnapshot = buildFusionSnapshot(input);
  const methodInputProvenance: readonly MethodInputProvenance[] = classifyMethodInputProvenance({
    executedMethodIds: ['CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY_ROUTER'],
    routerPortfolioOrigin: 'DERIVED_FROM_REAL', aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  return {
    fusionSnapshot, snapshotContentHash: fusionSnapshot.contentHash, strategyFrontier: null,
    canonicalFrontierInput: realCanonicalFrontierInput, methodInputProvenance,
    orchestration: { receipt: { selectedCandidateId: null }, thetaQ: null, shadowOpportunities: [] },
  } as unknown as ThetaShadowCycleResult;
}

test('REAL_CANONICAL_BRAIN_REPLAY (writer-integrated): the real Postgres evidence writer persists canonicalFrontierInput, and the decoded archive replays to the real frontier', () => {
  const cycle = realisticCycle();
  const projection = projectCycleEvidenceForPostgres(cycle);
  const decoded = decodeCycleEvidenceArchive(projection.archive);
  assert.ok('canonicalFrontierInput' in decoded, 'the writer must persist this field, not silently drop it');
  assert.ok('methodInputProvenance' in decoded, 'the writer must persist methodInputProvenance, not silently drop it');
  assert.deepEqual(decoded.methodInputProvenance, cycle.methodInputProvenance,
    'the exact already-computed methodInputProvenance must survive the roundtrip, never recomputed');

  const decodedBundle = t0ReplayBundleSchema.parse(buildT0ReplayBundle(decoded.canonicalFrontierInput as CanonicalStrategyFrontierInput));
  const originalBundle = buildT0ReplayBundle(realCanonicalFrontierInput);
  assert.deepEqual(decodedBundle, originalBundle, 'the writer must round-trip the exact input, no parallel reconstruction');

  const replayed = replayFromT0Bundle(decodedBundle);
  const original = replayFromT0Bundle(originalBundle);
  assert.equal(replayed.selectedCandidateId, original.selectedCandidateId);
  assert.equal(replayed.selectedBranch, original.selectedBranch);
  assert.equal(replayed.primaryAction, original.primaryAction);
  assert.equal(replayed.selectedQuantity, original.selectedQuantity);
  assert.equal(replayed.contentHash, original.contentHash, 'deterministic identity must match when replayed from the persisted bundle');
});
