import assert from 'node:assert/strict';
import test from 'node:test';
import { datasetRegistry, validateRegistry } from '../src/storage/data-platform/dataset-registry.js';
import { buildFinalChainReceipt, type FinalChainState } from '../src/storage/data-platform/final-chain-receipt.js';
import { encodeFinalizedExecutionHistory } from '../src/storage/data-platform/finalized-execution-history.js';
import { buildRuntimeSessionAggregate, decideHistoricalCompaction } from '../src/storage/data-platform/historical-compaction.js';
import { aggregateProjectedFrontiers } from '../src/storage/data-platform/runtime-session-aggregate-store.js';
import { buildSessionIntegrityManifest, verifySessionIntegrityManifest, type DecisionIntegrityInput } from '../src/storage/data-platform/session-integrity.js';
import { validateSessionFinalizationInput } from '../src/storage/data-platform/session-finalizer.js';
import { makeHarness, sessionDates } from './helpers/data-platform-model.js';

const decision = (id: string, quantity = '0'): DecisionIntegrityInput => ({
  decisionId: id,
  decidedAt: `2026-10-0${id === 'd1' ? '1' : '2'}T14:30:00.000Z`,
  action: quantity === '0' ? 'WAIT' : 'OPEN_SHORT_PUT',
  strategy: 'THETA_Q',
  selectedCandidateId: quantity === '0' ? null : 'candidate-1',
  quantity,
  aegisOutcome: 'ALLOW_FULL',
  sizingOutcome: quantity === '0' ? 'ZERO' : 'POSITIVE',
  bindingConstraint: quantity === '0' ? 'CAPITAL' : 'TICKER_CAP',
  chainId: quantity === '0' ? null : '11111111-1111-4111-8111-111111111111',
  archivalTerminal: quantity === '0',
  policyVersions: { risk: 'risk-v1', sizing: 'sizing-v1' },
  sourceSha: 'a'.repeat(40),
  archiveId: 'b'.repeat(40),
  archiveHash: 'c'.repeat(64),
});

const terminalState = (overrides: Partial<FinalChainState> = {}): FinalChainState => ({
  chainId: '11111111-1111-4111-8111-111111111111', lifecycleTerminal: true, openOptionExposure: false, openStockExposure: false,
  workingOrder: false, partialFill: false, unknownResultOrder: false, reconciliationPending: false, managementTerminal: true,
  orders: 'RESOLVED', fills: 'RESOLVED', inventory: 'RESOLVED', assignment: 'NOT_APPLICABLE', wholeChainEconomics: 'RESOLVED', futureObservationLabels: 'RESOLVED', ...overrides,
});

test('every growing dataset has exactly one governed lifecycle class and no registry defect', () => {
  assert.deepEqual(validateRegistry(), []);
  assert.equal(datasetRegistry.every((policy) => policy.growthLifecycleClass.length > 0), true);
  assert.equal(datasetRegistry.find((policy) => policy.id === 'decision-audit')?.hotSessions, 60);
  assert.equal(datasetRegistry.find((policy) => policy.id === 'broker-history')?.growthLifecycleClass, 'ACTIVE_OPERATIONAL_TRUTH');
  assert.equal(datasetRegistry.find((policy) => policy.id === 'finalized-execution-history')?.coldPolicy, 'ARCHIVE_THEN_RETIRE_PARTITION');
});

test('session integrity root is deterministic across input order and detects mutation', () => {
  const base = { sessionId: 'XNYS-2026-10-02', sessionDate: '2026-10-02', parquetManifestHashes: ['d'.repeat(64)], sourceSha: 'a'.repeat(40), policyVersions: { storage: 'v1' }, schemaVersions: ['071'], previousSessionIntegrityRoot: 'e'.repeat(64), createdAt: '2026-10-02T21:00:00.000Z', verifiedAt: '2026-10-02T21:01:00.000Z' } as const;
  const first = buildSessionIntegrityManifest({ ...base, decisions: [decision('d2', '1'), decision('d1')] });
  const reordered = buildSessionIntegrityManifest({ ...base, decisions: [decision('d1'), decision('d2', '1')] });
  assert.equal(first.manifestHash, reordered.manifestHash);
  assert.deepEqual(verifySessionIntegrityManifest(first, [decision('d1'), decision('d2', '1')]), []);
  assert.deepEqual(verifySessionIntegrityManifest(first, [decision('d1'), decision('d2', '2')]), ['DECISION_ROOT', 'CHAINED_SESSION_ROOT']);
});

test('session integrity canonical vector is stable across implementations', () => {
  const vector: DecisionIntegrityInput = {
    decisionId: '00000000-0000-4000-8000-000000000001', decidedAt: '2026-10-02T19:00:00.000Z', action: 'WAIT', strategy: 'Q',
    selectedCandidateId: null, quantity: '0', aegisOutcome: 'ALLOW', sizingOutcome: 'ZERO', bindingConstraint: 'ACCOUNT_CAPACITY', chainId: null, archivalTerminal: true,
    policyVersions: { entry: 'v1' }, sourceSha: 'a'.repeat(40), archiveId: 'b'.repeat(40), archiveHash: 'c'.repeat(64),
  };
  const manifest = buildSessionIntegrityManifest({ sessionId: 'XNYS-2026-10-02', sessionDate: '2026-10-02', decisions: [vector], parquetManifestHashes: ['d'.repeat(64)], sourceSha: 'a'.repeat(40), policyVersions: { storage: 'v1' }, schemaVersions: ['071'], previousSessionIntegrityRoot: 'e'.repeat(64), createdAt: '2026-10-02T21:00:00.000Z', verifiedAt: '2026-10-02T21:01:00.000Z' });
  assert.equal(manifest.decisionIntegrityRoot, 'dfa24ca10b8e67244355e5b68595e51dc051d8a800f467d9bc4fbce146ac408f');
  assert.equal(manifest.sessionIntegrityRoot, '16f4bcd940bed3d84ae18d641176e7c97514b45897d57566e1bc28248d3b4863');
  assert.equal(manifest.manifestHash, '3df5896561bb4585c061d185d85c4f18ff7397953e27dc8818981f431bfb128c');
});

test('unresolved exposure can never become archive eligible', () => {
  const receipt = buildFinalChainReceipt({ state: terminalState({ openStockExposure: true, reconciliationPending: true }), finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1' });
  assert.equal(receipt.archiveEligible, false);
  assert.deepEqual(receipt.blockers, ['OPEN_STOCK_EXPOSURE', 'RECONCILIATION_PENDING']);
  const result = decideHistoricalCompaction({ decisionId: 'd1', ageSessions: 100, archiveVerified: true, replayVerified: true, primaryArchiveVerified: true, secondaryAuthorityVerified: true, offMachineAuthorityVerified: true, finalChainReceipt: receipt });
  assert.equal(result.disposition, 'KEEP_ACTIVE_DETAIL');
  assert.equal(result.eligible, false);
  assert.throws(() => encodeFinalizedExecutionHistory({ chainId: receipt.chainId, finalizedAt: receipt.finalizedAt, finalChainReceipt: receipt,
    orders: [], fills: [], inventory: [], assignmentExerciseExpiration: [], managementActions: [], wholeChainEconomics: {}, outcomeLabels: [], provenance: {}, sourceSha: 'a'.repeat(40), policyVersion: 'v1' }), /FINAL_CHAIN_NOT_ARCHIVE_ELIGIBLE/);
});

test('provider-limited broker or accounting truth cannot become terminal archival evidence', () => {
  for (const field of ['orders', 'fills', 'inventory', 'assignment', 'wholeChainEconomics'] as const) {
    const receipt = buildFinalChainReceipt({
      state: terminalState({ [field]: 'PROVIDER_LIMITED_UNKNOWN' }),
      finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1',
    });
    assert.equal(receipt.archiveEligible, false, field);
    assert.equal(receipt.blockers.includes(`${field.toUpperCase()}_UNRESOLVED`), true, field);
  }
  const censoredResearchLabel = buildFinalChainReceipt({
    state: terminalState({ futureObservationLabels: 'PROVIDER_LIMITED_UNKNOWN' }),
    finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1',
  });
  assert.equal(censoredResearchLabel.archiveEligible, true);
});

test('session finalization refuses a final-chain receipt attributed to another session', () => {
  const receipt = buildFinalChainReceipt({ state: terminalState(), finalizedAt: '2026-10-03T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1' });
  assert.throws(() => validateSessionFinalizationInput({
    sessionId: 'XNYS-2026-10-02', sessionDate: '2026-10-02', decisions: [], finalChainReceipts: [receipt],
    finalizedExecutionHistories: [], parquetManifestHashes: [], sourceSha: 'a'.repeat(40),
    policyVersions: { storage: 'v1' }, schemaVersions: ['071'], finalizedAt: '2026-10-02T21:00:00.000Z',
  }), /FINAL_CHAIN_RECEIPT_OUTSIDE_SESSION/);
});

test('finalized execution history is deterministic and preserves whole-chain losses', () => {
  const receipt = buildFinalChainReceipt({ state: terminalState(), finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1' });
  const input = { chainId: receipt.chainId, finalizedAt: receipt.finalizedAt, finalChainReceipt: receipt,
    orders: [{ orderId: 'o1' }], fills: [{ fillId: 'f1', realizedLossUsd: '-125.00' }], inventory: [], assignmentExerciseExpiration: [], managementActions: [{ action: 'ROLL', closedOldLegLossUsd: '-125.00' }],
    wholeChainEconomics: { realizedPnlUsd: '-125.00', unrealizedPnlUsd: '0.00' }, outcomeLabels: [], provenance: { truthClass: 'BROKER_ACTUAL' }, sourceSha: 'a'.repeat(40), policyVersion: 'v1' } as const;
  const first = encodeFinalizedExecutionHistory(input);
  const second = encodeFinalizedExecutionHistory(input);
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.gzip, second.gzip);
  assert.equal(first.record.wholeChainEconomics.realizedPnlUsd, '-125.00');
});

test('finalized execution history cannot detach from its terminal receipt provenance', () => {
  const receipt = buildFinalChainReceipt({ state: terminalState(), finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1' });
  const base = { chainId: receipt.chainId, finalizedAt: receipt.finalizedAt, finalChainReceipt: receipt,
    orders: [], fills: [], inventory: [], assignmentExerciseExpiration: [], managementActions: [],
    wholeChainEconomics: {}, outcomeLabels: [], provenance: {}, sourceSha: 'a'.repeat(40), policyVersion: 'v1' } as const;
  assert.throws(() => encodeFinalizedExecutionHistory({ ...base, sourceSha: 'b'.repeat(40) }), /FINAL_CHAIN_SOURCE_SHA_MISMATCH/);
  assert.throws(() => encodeFinalizedExecutionHistory({ ...base, finalizedAt: '2026-10-02T21:00:01.000Z' }), /FINAL_CHAIN_FINALIZED_AT_MISMATCH/);
  assert.throws(() => encodeFinalizedExecutionHistory({ ...base, policyVersion: 'v2' }), /FINAL_CHAIN_POLICY_VERSION_MISMATCH/);
});

test('two-stage decision retention requires every durability proof', () => {
  const receipt = buildFinalChainReceipt({ state: terminalState(), finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1' });
  const common = { decisionId: 'd1', archiveVerified: true, replayVerified: true, primaryArchiveVerified: true, secondaryAuthorityVerified: true, offMachineAuthorityVerified: true, finalChainReceipt: receipt } as const;
  assert.equal(decideHistoricalCompaction({ ...common, ageSessions: 2 }).disposition, 'KEEP_RECENT_DETAIL');
  assert.equal(decideHistoricalCompaction({ ...common, ageSessions: 20 }).disposition, 'KEEP_COMPACT_DECISION');
  assert.equal(decideHistoricalCompaction({ ...common, ageSessions: 80 }).disposition, 'RETIRE_DECISION_TO_COLD');
  const missing = decideHistoricalCompaction({ ...common, ageSessions: 80, offMachineAuthorityVerified: false });
  assert.equal(missing.disposition, 'KEEP_ACTIVE_DETAIL');
  assert.deepEqual(missing.blockers, ['OFF_MACHINE_AUTHORITY_NOT_VERIFIED']);
});

test('runtime session aggregation preserves zero and computes bounded percentiles', () => {
  const aggregate = buildRuntimeSessionAggregate({ sessionDate: '2026-10-02', decisionCount: 3, tradeCount: 0, waitReasonCounts: { CAPITAL: 3 }, strategyCounts: { THETA_Q: 3 }, aegisCounts: { ALLOW_FULL: 3 }, sizingCounts: { ZERO: 3 }, providerIncidentCounts: {}, errorCounts: {}, latenciesMs: [1, 2, 3, 100], storage: { peakBytes: 10, postArchiveBytes: 5 } });
  assert.deepEqual(aggregate.latencyMs, { p50: 2, p90: 100, p95: 100, p99: 100 });
  assert.equal(aggregate.tradeCount, 0);
});

test('queryable runtime aggregation uses exact selected-candidate AEGIS and sizing evidence', () => {
  const result = aggregateProjectedFrontiers([
    { key: 'THETA_CONVENTIONAL', n: 1, waits: 0, frontier_json: {
      selectedCandidateId: 'q-1', globalWaitReasons: [], branches: [{ candidates: [
        { candidateId: 'q-1', aegisState: 'ALLOW_REDUCED', sizing: { bindingConstraint: 'CONCENTRATION_CAP' } },
      ] }],
    } },
    { key: null, n: 1, waits: 1, frontier_json: {
      selectedCandidateId: null, globalWaitReasons: ['NO_RISK_FEASIBLE_ACTION'], branches: [],
    } },
  ]);
  assert.deepEqual(result.waitReasonCounts, { NO_RISK_FEASIBLE_ACTION: 1 });
  assert.deepEqual(result.aegisCounts, { ALLOW_REDUCED: 1, NOT_APPLICABLE_NO_SELECTED_CANDIDATE: 1 });
  assert.deepEqual(result.sizingCounts, { CONCENTRATION_CAP: 1, NOT_APPLICABLE_NO_SELECTED_CANDIDATE: 1 });
});

test('row-level terminality gate prevents retirement even after archive verification', async () => {
  const registeredPolicy = datasetRegistry.find((entry) => entry.id === 'cycle-evidence-blob');
  assert.ok(registeredPolicy);
  const policy = { ...registeredPolicy, hotSessions: 1 };
  const harness = makeHarness({ registry: [policy], retirementEligible: async () => ({ eligible: false, reason: 'OPEN_CHAIN' }) });
  const dates = sessionDates(3);
  assert.equal(dates.length, 3);
  for (const date of dates) harness.db.write(policy.id, date, [JSON.stringify({ date })], 1024);
  for (const [index, date] of dates.entries()) await harness.plane.postSession(date, dates.slice(0, index + 1), { preSessionBytes: 0, sessionPeakBytes: 0 }, dates[index + 1] ?? null);
  const records = await harness.store.list(policy.id);
  assert.equal(records.some((record) => record.state === 'DROPPED'), false);
  const lastDate = dates.at(-1);
  assert.ok(lastDate);
  const last = await harness.plane.postSession(lastDate, dates, { preSessionBytes: 0, sessionPeakBytes: 0 }, null);
  assert.equal(last.incidents.some((entry) => entry.detail.includes('TERMINALITY_GATE:OPEN_CHAIN')), true);
});
