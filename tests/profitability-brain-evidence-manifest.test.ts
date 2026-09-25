import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { buildProfitabilityBrainRealityFromManifest, profitabilityBrainEvidenceManifestVersion,
  type ProfitabilityBrainEvidenceManifest } from '../src/theta/profitability-brain-evidence-manifest.js';

const sha = 'a'.repeat(40);
const makeManifest = (): ProfitabilityBrainEvidenceManifest => {
  const body = {
    contractVersion: profitabilityBrainEvidenceManifestVersion, canonicalSourceSha: sha, currentWorkerSha: sha,
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
  const broken = { ...original, currentWorkerSha: 'd'.repeat(40) };
  const result = buildProfitabilityBrainRealityFromManifest(broken);
  assert.ok(result.violations.includes('SOURCE_WORKER_SHA_MISMATCH'));
  assert.equal(result.receipt.methods.find((item) => item.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level,
    'L6_RUNTIME_REACHABLE');
});
