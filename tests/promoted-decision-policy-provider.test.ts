import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { empiricalModelRegistryVersion, type ModelRegistryRecord } from '../src/research/empirical-model-registry.js';
import { empiricalPolicyPromotionContractVersion } from '../src/theta/empirical-policy-promotion.js';
import {
  createPromotedEntryModelProvider, createPromotedStrategyRouterProvider,
  promotedDecisionPolicyProviderVersion, resolvePromotedOrBootstrapRouting,
  validatePromotedEntryModelArtifact, validatePromotedStrategyRouterArtifact,
  type ExplicitArtifactApproval,
} from '../src/theta/promoted-decision-policy-provider.js';
import type { StrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

const hash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
function approval(evidenceHash: string): ExplicitArtifactApproval {
  const unsigned = { state: 'PROMOTED' as const, approvedBy: 'owner-governance',
    approvedAt: '2026-09-01T00:00:00.000Z', governanceVersion: 'theta-governance-v1', evidenceHash };
  return { ...unsigned, contentHash: hash(unsigned) };
}

function entryRecord(): ModelRegistryRecord {
  return {
    contractVersion: empiricalModelRegistryVersion, modelId: 'entry-after-cost', modelVersion: 'v1',
    targetId: 'EXPECTED_WHOLE_CHAIN_NET_PNL', strategyScope: ['THETA_CONVENTIONAL'], actionScope: ['OPEN_CSP'],
    featureSetVersion: 'entry-features-v1', datasetId: 'entry-dataset-v1', datasetHash: 'a'.repeat(64),
    labelVersion: 'whole-chain-v1', codeSha: 'b'.repeat(40), trainingWindow: {
      start: '2025-01-01T00:00:00.000Z', end: '2025-06-01T00:00:00.000Z' },
    validationWindows: [{ start: '2025-07-01T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' }],
    finalOosWindow: { start: '2025-10-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    dependenceGroupingVersion: 'group-v1', purgeVersion: 'purge-v1', calibrationMethod: 'isotonic',
    calibrationArtifactHash: 'c'.repeat(64), costModelVersion: 'cost-v1', hyperparameterSearchId: null,
    numberOfTrials: 1, selectionBiasReceiptId: 'selection-bias-v1',
    metrics: { brierScore: 0.18, logLoss: 0.5, ece: 0.04, independentN: 120 },
    artifactHash: 'd'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z', promotionState: 'PAPER_PROMOTED',
    baselineModelId: null, isBaseline: true,
  };
}

test('entry model seam requires pinned OOS, calibration and explicit approval', async () => {
  const record = entryRecord();
  const artifact = { registryRecord: record, approval: approval(hash(record)) };
  assert.deepEqual(validatePromotedEntryModelArtifact(artifact), []);
  assert.equal(createPromotedEntryModelProvider(null, async () => { throw new Error('not called'); }), null);
  assert.ok(validatePromotedEntryModelArtifact({ ...artifact, registryRecord: { ...record, promotionState: 'SHADOW' } })
    .includes('ENTRY_MODEL_NOT_PAPER_PROMOTED'));
  assert.ok(validatePromotedEntryModelArtifact({ ...artifact, registryRecord: { ...record, targetId: 'UNSCOPED_TARGET' } })
    .includes('ENTRY_MODEL_TARGET_INVALID'));
  const evaluate = async (input: Parameters<NonNullable<ReturnType<typeof createPromotedEntryModelProvider>>['evaluate']>[0]) => ({
    contractVersion: promotedDecisionPolicyProviderVersion, snapshotId: input.snapshotId, decisionAt: input.decisionAt,
    modelId: record.modelId, modelVersion: record.modelVersion, targetId: 'EXPECTED_WHOLE_CHAIN_NET_PNL' as const,
    datasetHash: record.datasetHash,
    artifactHash: record.artifactHash, featureSetVersion: record.featureSetVersion,
    featureContentHash: input.featureContentHash,
    evidenceAvailableAt: input.decisionAt, predictions: input.candidateIds.map((candidateId) => ({ candidateId,
      targetId: 'EXPECTED_WHOLE_CHAIN_NET_PNL' as const, value: 12, calibratedUncertainty: 0.12 })),
    brokerAuthority: false, executionAuthorized: false,
  });
  const provider = createPromotedEntryModelProvider(artifact, evaluate);
  assert.ok(provider);
  const decision = await provider.evaluate({ snapshotId: 'snap', decisionAt: '2026-10-01T15:00:00.000Z',
    candidateIds: ['c1'], featureSetVersion: record.featureSetVersion, featureContentHash: 'e'.repeat(64) });
  assert.equal(decision?.predictions[0]?.candidateId, 'c1');
  assert.equal(decision?.targetId, 'EXPECTED_WHOLE_CHAIN_NET_PNL');
  assert.equal(decision?.executionAuthorized, false);
  const mismatchedProvider = createPromotedEntryModelProvider(artifact, async (input) => ({
    ...(await evaluate(input)), featureContentHash: '0'.repeat(64),
  }));
  assert.equal(await mismatchedProvider?.evaluate({ snapshotId: 'snap', decisionAt: '2026-10-01T15:00:00.000Z',
    candidateIds: ['c1'], featureSetVersion: record.featureSetVersion, featureContentHash: 'e'.repeat(64) }), null);
});

function routerReceipt() {
  return {
    contractVersion: empiricalPolicyPromotionContractVersion, policyKind: 'STRATEGY_ROUTER' as const,
    policyVersion: 'router-v2', datasetVersion: 'router-dataset-v1', datasetHash: 'f'.repeat(64),
    featureSetVersion: 'router-features-v1', labelResolverVersion: 'router-label-v1', executionModelVersion: 'cost-v1',
    strategyVersions: ['q-v1', 'h-v1', 'd-v1'], trainWindow: { start: '2025-01-01T00:00:00.000Z', end: '2025-06-01T00:00:00.000Z' },
    validationWindow: { start: '2025-06-08T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' },
    outOfSampleWindow: { start: '2025-09-08T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' }, embargoDays: 7,
    metrics: { effectiveIndependentN: 100, managedEpisodeWinRate: 0.6, wholeChainWinRate: 0.55,
      afterCostExpectedValue: 12, profitFactor: 1.4, averageWin: 50, averageLoss: -35, maxDrawdown: -500,
      expectedShortfall: -80, capitalDays: 25000, brierScore: 0.2, realizedSlippage: 3,
      returnOnSecuredCapital: 0.08, annualizedCapitalReturn: 0.12, deflatedSharpeRatio: 0.8,
      probabilityOfBacktestOverfitting: 0.2 }, acceptanceCriteriaVersion: 'router-acceptance-v1',
    acceptanceCriteria: [{ id: 'oos', description: 'OOS criteria passed', passed: true, evidenceReference: 'experiment:router' }],
    executionEvidence: 'PROVEN' as const, approval: 'APPROVED' as const, approvalIdentity: 'owner-governance',
    approvalTimestamp: '2026-08-02T00:00:00.000Z',
  };
}

const routing = (policyVersion = 'bootstrap-v1'): StrategyRoutingResponse => ({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap', timestamp: '2026-10-01T15:00:00.000Z',
  policyVersion, results: ['THETA_Q','THETA_H','THETA_R','THETA_A','THETA_C','THETA_D'].map((strategyFamily) => ({
    strategyFamily: strategyFamily as StrategyRoutingResponse['results'][number]['strategyFamily'], eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_PRIMARY' as const : 'INELIGIBLE_STATE' as const,
    reasons: [{ code: 'FIXTURE', polarity: 0 as const, detail: 'fixture routing evidence' }], policyVersion,
  })),
});

test('strategy-router seam falls back safely and accepts only exact promoted lineage', async () => {
  const receipt = routerReceipt();
  const artifact = { receipt, approval: approval(hash(receipt)) };
  assert.deepEqual(validatePromotedStrategyRouterArtifact(artifact), []);
  assert.ok(validatePromotedStrategyRouterArtifact({ ...artifact,
    approval: { ...artifact.approval, state: 'REJECTED' as 'PROMOTED' } })
    .includes('STRATEGY_ROUTER_EXPLICIT_APPROVAL_MISSING'));
  const bootstrap = routing();
  assert.equal((await resolvePromotedOrBootstrapRouting(null, { snapshotId: 'snap', decisionAt: bootstrap.timestamp, bootstrap })).authority,
    'BOOTSTRAP_APPLICABILITY_ROUTER');
  const provider = createPromotedStrategyRouterProvider(artifact, async (input) => ({ snapshotId: input.snapshotId,
    decisionAt: input.decisionAt, policyVersion: receipt.policyVersion, datasetHash: receipt.datasetHash,
    evidenceAvailableAt: input.decisionAt, routing: routing(receipt.policyVersion), brokerAuthority: false,
    executionAuthorized: false }));
  assert.ok(provider);
  const resolved = await resolvePromotedOrBootstrapRouting(provider, { snapshotId: 'snap', decisionAt: bootstrap.timestamp, bootstrap });
  assert.equal(resolved.authority, 'EMPIRICALLY_PROMOTED_STRATEGY_ROUTER');
  assert.equal(resolved.routing.policyVersion, receipt.policyVersion);
});
