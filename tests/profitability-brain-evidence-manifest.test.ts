import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { buildProfitabilityBrainRealityFromManifest, profitabilityBrainEvidenceManifestVersion,
  type ProfitabilityBrainEvidenceManifest } from '../src/theta/profitability-brain-evidence-manifest.js';

const sha = 'a'.repeat(40);
const makeManifest = (): ProfitabilityBrainEvidenceManifest => {
  const body = {
    contractVersion: profitabilityBrainEvidenceManifestVersion, evidenceClass: 'CURRENT_RUNTIME' as const,
    canonicalSourceSha: sha, evidenceWorkerSha: sha,
    generatedAt: '2026-09-25T15:00:00.000Z',
    runtime: [{ methodId: 'STRATEGY_APPLICABILITY_ROUTER', evidenceId: 'runtime-1', evidenceHash: 'b'.repeat(64),
      observedAt: '2026-09-25T14:59:00.000Z', sourceSha: sha, workerSha: sha }],
    empirical: [{ methodId: 'STRATEGY_APPLICABILITY_ROUTER', evidenceId: 'empirical-1', runtimeEvidenceId: 'runtime-1',
      datasetHash: 'c'.repeat(64), outOfSampleReceiptId: 'oos-1' }],
    brokerAuthorization: [{ methodId: 'STRATEGY_APPLICABILITY_ROUTER', evidenceId: 'broker-1', empiricalEvidenceId: 'empirical-1',
      approvalReceiptId: 'approval-1', environment: 'PAPER' as const, executionAuthorized: true as const }],
  };
  return { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
};

test('immutable linked evidence advances L7, L8 and L9 sequentially', () => {
  const result = buildProfitabilityBrainRealityFromManifest(makeManifest());
  assert.deepEqual(result.violations, []);
  assert.equal(result.receipt.methods.find((item) => item.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level,
    'L9_BROKER_AUTHORIZED');
});

test('release mismatch or broken linkage cannot self-declare current-worker proof', () => {
  const original = makeManifest();
  const broken = { ...original, evidenceWorkerSha: 'd'.repeat(40) };
  const result = buildProfitabilityBrainRealityFromManifest(broken);
  assert.ok(result.violations.includes('SOURCE_WORKER_SHA_MISMATCH'));
  assert.equal(result.receipt.methods.find((item) => item.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level,
    'L6_RUNTIME_REACHABLE');
});

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 8-10): a
// HISTORICAL_REAL_RUNTIME manifest must land in historicalRealData, never
// currentWorkerRealData/L7 -- even with an otherwise perfectly valid
// manifest.
test('a HISTORICAL_REAL_RUNTIME manifest reaches historicalRealData=true but never L7_CURRENT_WORKER_REAL_DATA', () => {
  const original = makeManifest();
  const body = { contractVersion: original.contractVersion, evidenceClass: 'HISTORICAL_REAL_RUNTIME' as const,
    canonicalSourceSha: original.canonicalSourceSha, evidenceWorkerSha: original.evidenceWorkerSha,
    generatedAt: original.generatedAt, runtime: original.runtime, empirical: original.empirical,
    brokerAuthorization: original.brokerAuthorization };
  const manifest = { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
  const result = buildProfitabilityBrainRealityFromManifest(manifest);
  assert.deepEqual(result.violations, []);
  const method = result.receipt.methods.find((item) => item.methodId === 'STRATEGY_APPLICABILITY_ROUTER');
  assert.equal(method?.evidence.historicalRealData, true);
  assert.equal(method?.evidence.currentWorkerRealData, false);
  assert.notEqual(method?.level, 'L7_CURRENT_WORKER_REAL_DATA');
});

test('an invalid evidenceClass is rejected, never silently defaulted', () => {
  const original = makeManifest();
  const invalid = { ...original, evidenceClass: 'SOMETHING_ELSE' } as unknown as ProfitabilityBrainEvidenceManifest;
  const result = buildProfitabilityBrainRealityFromManifest(invalid);
  assert.ok(result.violations.includes('EVIDENCE_CLASS_INVALID'));
});
