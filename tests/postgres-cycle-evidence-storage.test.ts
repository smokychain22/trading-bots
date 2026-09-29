import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { buildFusionSnapshot, hashJson, type FusionSnapshotInput } from '../src/market/fusion-snapshot.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import {
  decodeCycleEvidenceArchive,
  postgresCycleEvidenceStorageVersion,
  projectCanonicalFrontierForPostgres,
  projectCycleEvidenceForPostgres,
  projectDecisionReceiptForPostgres,
} from '../src/theta/postgres-cycle-evidence-storage.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { projectOperationalThetaCandidates } from '../src/theta/postgres-theta-cycle-store.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';
import { flatPortfolioExposure } from './helpers/flat-portfolio-exposure.js';

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
    accountState: { status: 'ACTIVE' }, positionState: { positions: [], orders: [] },
    portfolioExposure: flatPortfolioExposure(),
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
  assert.equal(sha(canonicalJson(decoded)), projection.archiveHash);
  assert.equal(hashJson(decoded.snapshot as never), value.snapshotContentHash);
  const decodedSnapshot = decoded.snapshot as Record<string, unknown>;
  assert.equal((decodedSnapshot.contractCandidates as unknown[]).length, 120);
  assert.equal((projection.snapshot.contractCandidates as unknown[]).length, 4);
  assert.equal((projection.snapshot.optionomicsFeatureState as Record<string, unknown>).storageState,
    'FULL_STATE_IN_COMPRESSED_CYCLE_ARCHIVE');
});

test('packed archive reconstructs duplicated provider and T0 inputs exactly', () => {
  const original = cycle();
  assert.ok(original.fusionSnapshot !== null);
  const snapshot = original.fusionSnapshot.snapshot;
  const optionomics = snapshot.optionomicsFeatureState as Record<string, unknown>;
  const rawObservations = optionomics.rawObservations as { payload: unknown }[];
  const expandedSnapshot = {
    ...snapshot,
    optionomicsFeatureState: { ...optionomics, rawObservation: { payload: rawObservations[0]?.payload } },
  };
  const expanded = {
    ...original,
    fusionSnapshot: { ...original.fusionSnapshot, snapshot: expandedSnapshot },
    strategyFrontier: { snapshotId: 'test-frontier', optionomicsContext: optionomics.features,
      branches: [], selectedCandidateId: null, nearMissCandidateId: null, bestRejectedCandidateId: null },
    canonicalFrontierInput: { contracts: snapshot.contractCandidates, snapshotId: 'test-t0',
      optionomicsContext: optionomics.features },
  } as unknown as ThetaShadowCycleResult;
  const projection = projectCycleEvidenceForPostgres(expanded);
  const decoded = decodeCycleEvidenceArchive(projection.archive);
  assert.equal(decoded.contractVersion, postgresCycleEvidenceStorageVersion);
  assert.equal(canonicalJson(decoded.snapshot), canonicalJson(expandedSnapshot as never));
  assert.equal(canonicalJson(decoded.strategyFrontier), canonicalJson(expanded.strategyFrontier as never));
  assert.equal(canonicalJson(decoded.canonicalFrontierInput), canonicalJson(expanded.canonicalFrontierInput as never));
  assert.equal(sha(canonicalJson(decoded as never)), projection.archiveHash);
  assert.ok(projection.archiveCompressedBytes < 4 * 1024 * 1024);
});

test('distant repeated derived Optionomics context reconstructs exact frontier and T0 with one archive copy', () => {
  const original = cycle();
  assert.ok(original.fusionSnapshot !== null);
  const bulk = Array.from({ length: 70_000 }, (_, index) => sha(`derived-feature-${index}`)).join('');
  const features = { schemaVersion: 'test-v1', contracts: [], derived: bulk };
  const snapshot = { ...original.fusionSnapshot.snapshot,
    optionomicsFeatureState: { rawObservations: [], features } };
  const expanded = { ...original, fusionSnapshot: { ...original.fusionSnapshot, snapshot },
    strategyFrontier: { snapshotId: 'large-frontier', optionomicsContext: features,
      branches: [], selectedCandidateId: null, nearMissCandidateId: null, bestRejectedCandidateId: null },
    canonicalFrontierInput: { snapshotId: 'large-t0', contracts: snapshot.contractCandidates,
      optionomicsContext: features } } as unknown as ThetaShadowCycleResult;
  const projection = projectCycleEvidenceForPostgres(expanded);
  assert.ok(projection.archiveCompressedBytes <= 4 * 1024 * 1024);
  const decoded = decodeCycleEvidenceArchive(projection.archive);
  assert.equal(canonicalJson(decoded.snapshot), canonicalJson(snapshot as never));
  assert.equal(canonicalJson(decoded.strategyFrontier), canonicalJson(expanded.strategyFrontier as never));
  assert.equal(canonicalJson(decoded.canonicalFrontierInput), canonicalJson(expanded.canonicalFrontierInput as never));
  assert.equal(sha(canonicalJson(decoded)), projection.archiveHash);
});

test('historical v2 gzip archives remain readable and malformed v3 references fail closed', () => {
  const historical = { contractVersion: 'theta-postgres-cycle-evidence-storage-v2', snapshot: { botId: 'THETA' } };
  assert.deepEqual(decodeCycleEvidenceArchive(gzipSync(JSON.stringify(historical))), historical);
  const malformed = {
    format: 'THETA_PACKED_CYCLE_V3',
    evidence: { contractVersion: postgresCycleEvidenceStorageVersion, snapshot: {} },
    references: ['CANONICAL_FRONTIER_CONTRACTS'],
  };
  const archive = gzipSync(Buffer.concat([Buffer.from('THETA_BR1\0'),
    brotliCompressSync(Buffer.from(JSON.stringify(malformed)))]));
  assert.throws(() => decodeCycleEvidenceArchive(archive), /FUSION_CYCLE_ARCHIVE_REFERENCE_INVALID/);
});

test('distant repeated provider evidence exceeds the old gzip cap but round-trips below the governed cap', () => {
  const original = cycle();
  assert.ok(original.fusionSnapshot !== null);
  const bulk = Array.from({ length: 55_000 }, (_, index) => sha(`provider-row-${index}`)).join('');
  const payload = { rows: bulk };
  const snapshot = {
    ...original.fusionSnapshot.snapshot,
    optionomicsFeatureState: {
      rawObservation: { payload }, rawObservations: [{ payload }],
      features: { bulk, contracts: [] }, optionChain: [], netFlowWindows: [],
    },
  };
  const expanded = {
    ...original,
    fusionSnapshot: { ...original.fusionSnapshot, snapshot },
    canonicalFrontierInput: { contracts: snapshot.contractCandidates, snapshotId: 'large-t0' },
  } as unknown as ThetaShadowCycleResult;
  const oldShape = {
    contractVersion: 'theta-postgres-cycle-evidence-storage-v2',
    snapshotContentHash: original.snapshotContentHash, snapshot,
    strategyFrontier: original.strategyFrontier,
    thetaQ: original.orchestration?.thetaQ ?? null,
    decisionReceipt: original.orchestration?.receipt ?? null,
    shadowOpportunities: original.orchestration?.shadowOpportunities ?? [],
    canonicalFrontierInput: expanded.canonicalFrontierInput,
    methodInputProvenance: expanded.methodInputProvenance,
  };
  assert.ok(gzipSync(Buffer.from(canonicalJson(oldShape as never)), { level: 9 }).length > 4 * 1024 * 1024);
  const projection = projectCycleEvidenceForPostgres(expanded);
  assert.ok(projection.archiveCompressedBytes <= 4 * 1024 * 1024);
  const decoded = decodeCycleEvidenceArchive(projection.archive);
  assert.equal(canonicalJson(decoded.snapshot), canonicalJson(snapshot as never));
  assert.equal(canonicalJson(decoded.canonicalFrontierInput), canonicalJson(expanded.canonicalFrontierInput as never));
});

test('oversize archive fails closed and production telemetry reports sizes without provider contents', () => {
  const original = cycle();
  assert.ok(original.fusionSnapshot !== null);
  const bulk = Array.from({ length: 200_000 }, (_, index) => sha(`unique-provider-row-${index}`)).join('');
  const snapshot = { ...original.fusionSnapshot.snapshot,
    optionomicsFeatureState: { rawObservations: [{ payload: { rows: bulk } }], features: { contracts: [] } } };
  const expanded = { ...original, fusionSnapshot: { ...original.fusionSnapshot, snapshot } } as ThetaShadowCycleResult;
  const priorEnvironment = process.env.VERCEL_ENV;
  const priorError = console.error;
  const telemetry: string[] = [];
  try {
    process.env.VERCEL_ENV = 'production';
    console.error = (line: unknown) => { telemetry.push(String(line)); };
    assert.throws(() => projectCycleEvidenceForPostgres(expanded), /FUSION_CYCLE_ARCHIVE_POLICY_PAYLOAD_TOO_LARGE/);
  } finally {
    console.error = priorError;
    if (priorEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = priorEnvironment;
  }
  assert.equal(telemetry.length, 1);
  const receipt = JSON.parse(telemetry[0] ?? '{}') as Record<string, unknown>;
  assert.equal(receipt.event, 'THETA_CYCLE_ARCHIVE_OVERSIZE_V1');
  assert.ok(Number(receipt.archiveBytes) > 4 * 1024 * 1024);
  assert.ok(Number(receipt.optionomicsRawObservationsBytes) > 4 * 1024 * 1024);
  assert.ok(Number(receipt.optionomicsRawObservationsCompressedBytes) > 0);
  assert.ok(!telemetry[0]?.includes(bulk.slice(0, 64)));
});

test('operational candidate projection keeps selected and diagnostic near-misses without duplicating the full research set', () => {
  const value = cycle();
  const projected = projectOperationalThetaCandidates(value);
  assert.ok(projected.length <= 12);
  assert.ok(projected.some((candidate) => candidate.candidateId === value.orchestration?.receipt.selectedCandidateId));
  assert.ok(projected.some((candidate) => candidate.actionFeasible));
  assert.ok(projected.some((candidate) => !candidate.actionFeasible));
});

test('queryable frontier and decision receipts remain bounded while preserving archive identity and selected economics', () => {
  const bulkyEvidence = Array.from({ length: 30_000 }, (_, index) => sha(`optionomics-${index}`)).join('');
  const selectedCandidate = {
    candidateId: 'SPY261016P00400000', economics: { executableCredit: 1.25 },
    hardBlockers: [], sizing: { quantity: 1, bindingConstraint: 'BUYING_POWER', reasons: [] },
  };
  const adaptive = {
    contractVersion: 'theta-adaptive-decision-brain-shadow-v4',
    adaptiveShadowDecision: { action: 'NO_COMPARISON', candidateId: null, quantity: null, strategy: null },
    shadowComparison: {
      version: 'theta-canonical-shadow-comparison-v2', brokerAuthority: false, profitabilityWinner: null,
      cohorts: [{ cohortId: 'SPY:2026-10-16', sourceCandidateIds: [selectedCandidate.candidateId],
        structuralParetoCandidateIds: [selectedCandidate.candidateId], structuralLeaderCandidateId: selectedCandidate.candidateId,
        structuralLeaderState: 'UNIQUE_STRUCTURAL_PARETO_LEADER', unresolvedDimensions: [],
        candidates: [{ candidateId: selectedCandidate.candidateId, rawEvidence: bulkyEvidence.slice(0, 180_000) }] }],
      excluded: [], candidateEligibility: [],
    },
    contentHash: sha('adaptive-full'),
  };
  const frontier = {
    selectedCandidateId: selectedCandidate.candidateId, nearMissCandidateId: null, bestRejectedCandidateId: null,
    branches: [{ bestCandidateId: selectedCandidate.candidateId, secondBestCandidateId: null,
      bestRejectedCandidateId: null, candidates: [selectedCandidate] }],
    optionomicsContext: { rawEvidence: bulkyEvidence }, adaptiveShadowDecision: adaptive,
    primaryAction: 'OPEN_CSP', selectedQuantity: 1, contentHash: sha('full-frontier'),
  } as unknown as CanonicalStrategyFrontier;
  assert.ok(Buffer.byteLength(canonicalJson(frontier as never)) > 768 * 1024);
  const projected = projectCanonicalFrontierForPostgres(frontier);
  const record = projected.projection;
  assert.ok(Buffer.byteLength(canonicalJson(record as never)) < 768 * 1024);
  assert.equal((record.optionomicsContext as Record<string, unknown>).fullStateHash,
    sha(canonicalJson(frontier.optionomicsContext)));
  const shadow = record.adaptiveShadowDecision as Record<string, unknown>;
  assert.equal(shadow.fullStateHash, sha(canonicalJson(adaptive as never)));
  assert.equal(shadow.contentHash, adaptive.contentHash);
  assert.equal(((shadow.shadowComparison as Record<string, unknown>).cohorts as unknown[]).length, 1);
  assert.equal(((record.branches as { candidates: { candidateId: string; economics: unknown }[] }[])[0]?.candidates[0]?.candidateId),
    selectedCandidate.candidateId);
  assert.deepEqual(((record.branches as { candidates: { economics: unknown }[] }[])[0]?.candidates[0]?.economics),
    selectedCandidate.economics);
  const decision = projectDecisionReceiptForPostgres({ authority: frontier, releaseIdentity: { sourceSha: 'a'.repeat(40) } });
  assert.ok(Buffer.byteLength(canonicalJson(decision.projection as never)) < 768 * 1024);
  assert.equal((decision.projection.authority as Record<string, unknown>).contentHash, frontier.contentHash);
  assert.equal(adaptive.shadowComparison.cohorts[0]?.candidates[0]?.rawEvidence.length, 180_000,
    'projection must not mutate the full in-memory archive evidence');
});
