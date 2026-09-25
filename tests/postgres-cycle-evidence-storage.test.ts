import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildFusionSnapshot, hashJson, type FusionSnapshotInput } from '../src/market/fusion-snapshot.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import {
  decodeCycleEvidenceArchive,
  postgresCycleEvidenceStorageVersion,
  projectCycleEvidenceForPostgres,
} from '../src/theta/postgres-cycle-evidence-storage.js';
import { projectOperationalThetaCandidates } from '../src/theta/postgres-theta-cycle-store.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const now = '2026-09-25T15:00:00.000Z';

function contract(index: number) {
  const strike = 400 + index;
  const symbol = `SPY261016P${String(strike * 1000).padStart(8, '0')}`;
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: symbol, occSymbol: symbol,
    optionType: 'PUT', strike, expiration: '2026-10-16', asOfDate: '2026-09-25', multiplier: 100,
    contractTradable: true, exerciseStyle: 'AMERICAN', deliverableClassification: 'STANDARD_EQUITY',
    underlyingBid: 665, underlyingAsk: 665.02, underlyingLast: 665.01, underlyingTimestamp: now,
    underlyingQuoteReceivedAt: now, underlyingQuoteSource: 'ALPACA_IEX',
    bid: 1 + index / 100, ask: 1.05 + index / 100, bidSize: 10, askSize: 10,
    lastTradePrice: null, lastTradeSize: null, quoteTimestamp: now, tradeTimestamp: null,
    volume: 100, volumeSource: 'ALPACA', openInterest: 500, openInterestSource: 'ALPACA',
    iv: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1, rho: -0.02,
    greeksTimestamp: now, greeksSource: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 60, maxSpreadPctForExecutable: 0.1,
  }, now);
}

function cycle(): ThetaShadowCycleResult {
  const contracts = Array.from({ length: 120 }, (_, index) => contract(index));
  const input: FusionSnapshotInput = {
    botId: 'THETA', decisionTimeUtc: now, triggerType: 'TEST', marketSession: { isOpen: true },
    underlyingState: { symbol: 'SPY', last: 665.01 }, contractCandidates: contracts,
    accountState: { status: 'ACTIVE' }, positionState: { positions: [], orders: [] }, portfolioExposure: {},
    alpacaQuoteState: null,
    optionomicsFeatureState: {
      rawObservations: Array.from({ length: 20 }, (_, index) => ({ operationAlias: `op-${index}`, payload: { rows: contracts } })),
      features: { schemaVersion: 'test-v1', contracts, unavailableFamilies: [] },
      netFlowWindows: Array.from({ length: 10 }, () => ({ netCalls: contracts, netPuts: contracts })),
    },
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
  const candidates = contracts.slice(0, 20).map((item, index) => ({
    candidateId: item.optionSymbol, rank: index + 1, actionFeasible: index === 0, quantity: index === 0 ? 1 : 0,
    economics: null, ownershipScore: null, eligibilityBasis: 'INELIGIBLE' as const,
    paperBootstrapPolicyVersion: null, paperBootstrapAllowedUnknownComponents: [], paperBootstrapReasonCodes: [],
    reasons: [{ code: index === 0 ? 'PASS' : 'REJECTED', polarity: index === 0 ? 1 as const : -1 as const, detail: 'test' }],
  }));
  return {
    fusionSnapshot, snapshotContentHash: fusionSnapshot.contentHash, strategyFrontier: null,
    orchestration: {
      receipt: { selectedCandidateId: contracts[9]?.optionSymbol ?? null },
      thetaQ: { candidates }, shadowOpportunities: [],
    },
  } as unknown as ThetaShadowCycleResult;
}

test('PostgreSQL projection is bounded while compressed archive retains the complete immutable cycle', () => {
  const value = cycle();
  const projection = projectCycleEvidenceForPostgres(value);
  assert.equal(projection.fullContractCount, 120);
  assert.equal(projection.projectedContractCount, 4);
  assert.ok(projection.archiveCompressedBytes < projection.archiveUncompressedBytes);
  assert.match(projection.archiveHash, /^[0-9a-f]{64}$/);
  const decoded = decodeCycleEvidenceArchive(projection.archive);
  assert.equal(decoded.contractVersion, postgresCycleEvidenceStorageVersion);
  assert.equal(decoded.snapshotContentHash, value.snapshotContentHash);
  assert.equal(hashJson(decoded.snapshot as never), value.snapshotContentHash);
  const decodedSnapshot = decoded.snapshot as Record<string, unknown>;
  assert.equal((decodedSnapshot.contractCandidates as unknown[]).length, 120);
  assert.equal((projection.snapshot.contractCandidates as unknown[]).length, 4);
  assert.equal((projection.snapshot.optionomicsFeatureState as Record<string, unknown>).storageState,
    'FULL_STATE_IN_COMPRESSED_CYCLE_ARCHIVE');
});

test('operational candidate projection keeps selected and diagnostic near-misses without duplicating the full research set', () => {
  const value = cycle();
  const projected = projectOperationalThetaCandidates(value);
  assert.ok(projected.length <= 12);
  assert.ok(projected.some((candidate) => candidate.candidateId === value.orchestration?.receipt.selectedCandidateId));
  assert.ok(projected.some((candidate) => candidate.actionFeasible));
  assert.ok(projected.some((candidate) => !candidate.actionFeasible));
});
