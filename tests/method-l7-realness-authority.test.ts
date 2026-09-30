import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { classifyMethodInputProvenance, filterToRealInputEvidence } from '../src/theta/profitability-method-input-provenance.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import {
  buildProfitabilityBrainRealityFromManifest, profitabilityBrainEvidenceManifestVersion,
  type ProfitabilityBrainEvidenceManifest, type ProfitabilityRuntimeEvidence,
} from '../src/theta/profitability-brain-evidence-manifest.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 source-final (items 11-13): current
// L7 promotion must require BOTH real execution AND per-method REAL input
// realness -- never execution alone. This is the single authority
// (filterToRealInputEvidence + classifyMethodInputProvenance), replacing
// the old broad aegisInputsOrigin-only exclusion. Method-by-method, exactly
// as required.
const sha = 'a'.repeat(40);
const executedAll = [
  'CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY_ROUTER', 'CONVENTIONAL_CANDIDATE_ENUMERATION',
  'AEGIS_RISK_PERMISSION', 'CONSTRAINED_QUANTITY_SIZING', 'CANONICAL_ENTRY_SELECTION',
];

function levelFor(methodId: string, executedMethodIds: readonly string[], provenance: ReturnType<typeof classifyMethodInputProvenance>) {
  const realEvidence = filterToRealInputEvidence(executedMethodIds, provenance);
  const runtime: ProfitabilityRuntimeEvidence[] = realEvidence.map((id) => ({
    methodId: id, evidenceId: `run:${id}`, evidenceHash: createHash('sha256').update(id).digest('hex'),
    observedAt: '2026-09-26T00:00:00.000Z', sourceSha: sha, workerSha: sha,
  }));
  const body = { contractVersion: profitabilityBrainEvidenceManifestVersion, evidenceClass: 'CURRENT_RUNTIME' as const,
    canonicalSourceSha: sha, evidenceWorkerSha: sha, generatedAt: '2026-09-26T00:00:00.000Z',
    runtime, empirical: [], brokerAuthorization: [] };
  const manifest: ProfitabilityBrainEvidenceManifest = { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
  const result = buildProfitabilityBrainRealityFromManifest(manifest);
  return result.receipt.methods.find((m) => m.methodId === methodId)?.level;
}

test('1. router executed + MANUAL portfolio input -> no router L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'CALLER_MANUAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.notEqual(levelFor('STRATEGY_APPLICABILITY_ROUTER', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('2. Q enumeration with REAL market + REAL router input -> eligible for L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.equal(levelFor('CONVENTIONAL_CANDIDATE_ENUMERATION', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('3. Q enumeration with REAL market + MANUAL router -> no L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'CALLER_MANUAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.notEqual(levelFor('CONVENTIONAL_CANDIDATE_ENUMERATION', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('4. AEGIS PARTIAL_REAL (CALLER_MANUAL, the documented real/manual mix) -> no L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.equal(provenance.find((p) => p.methodId === 'AEGIS_RISK_PERMISSION')?.inputRealness, 'PARTIAL_REAL');
  assert.notEqual(levelFor('AEGIS_RISK_PERMISSION', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('5. sizing consuming PARTIAL_REAL AEGIS -> no L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.notEqual(levelFor('CONSTRAINED_QUANTITY_SIZING', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('6. selection with any decisive PARTIAL_REAL dependency -> no L7', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'CALLER_MANUAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  assert.equal(provenance.find((p) => p.methodId === 'CANONICAL_ENTRY_SELECTION')?.inputRealness, 'PARTIAL_REAL');
  assert.notEqual(levelFor('CANONICAL_ENTRY_SELECTION', executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA');
});

test('7. fully-real method input -> L7 allowed when source/worker identity also matches', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  for (const methodId of executedAll) {
    assert.equal(levelFor(methodId, executedAll, provenance), 'L7_CURRENT_WORKER_REAL_DATA', `${methodId} must reach L7`);
  }
});

test('7b. fully-real method inputs but MISMATCHED source/worker identity -> no L7 despite real inputs', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: executedAll, routerPortfolioOrigin: 'DERIVED_FROM_REAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  const realEvidence = filterToRealInputEvidence(executedAll, provenance);
  const runtime: ProfitabilityRuntimeEvidence[] = realEvidence.map((id) => ({
    methodId: id, evidenceId: `run:${id}`, evidenceHash: createHash('sha256').update(id).digest('hex'),
    observedAt: '2026-09-26T00:00:00.000Z', sourceSha: sha, workerSha: 'b'.repeat(40),
  }));
  const body = { contractVersion: profitabilityBrainEvidenceManifestVersion, evidenceClass: 'CURRENT_RUNTIME' as const,
    canonicalSourceSha: sha, evidenceWorkerSha: 'b'.repeat(40), generatedAt: '2026-09-26T00:00:00.000Z',
    runtime, empirical: [], brokerAuthorization: [] };
  const manifest: ProfitabilityBrainEvidenceManifest = { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
  const result = buildProfitabilityBrainRealityFromManifest(manifest);
  assert.ok(result.violations.includes('SOURCE_WORKER_SHA_MISMATCH'));
  assert.notEqual(result.receipt.methods.find((m) => m.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level, 'L7_CURRENT_WORKER_REAL_DATA');
});

test('an unclassified Q economic method cannot claim L7 from execution alone', () => {
  const provenance = classifyMethodInputProvenance({
    executedMethodIds: ['Q_STRUCTURAL_ECONOMIC_DECISION', 'AEGIS_RISK_PERMISSION'],
    routerPortfolioOrigin: 'CALLER_MANUAL',
    aegisInputsOrigin: 'DERIVED_FROM_REAL', marketDataOrigin: 'REAL_PROVIDER',
  });
  const realEvidence = filterToRealInputEvidence(
    ['Q_STRUCTURAL_ECONOMIC_DECISION', 'AEGIS_RISK_PERMISSION'], provenance);
  assert.deepEqual(realEvidence, ['AEGIS_RISK_PERMISSION']);
});

test('self-declared REAL cannot override manual, missing or policy-only decisive evidence', () => {
  for (const decisiveInputs of [[], [{ name: 'state', origin: 'CALLER_MANUAL' as const }],
    [{ name: 'policy', origin: 'VERSIONED_POLICY_CONSTANT' as const }],
    [{ name: 'quote', origin: 'REAL_PROVIDER' as const }, { name: 'state', origin: 'REAL_PROVIDER_UNKNOWN' as const }]]) {
    assert.deepEqual(filterToRealInputEvidence(['STRATEGY_APPLICABILITY_ROUTER'], [{
      methodId: 'STRATEGY_APPLICABILITY_ROUTER', executed: true, inputRealness: 'REAL', decisiveInputs, notes: 'untrusted claim',
    }]), []);
  }
});
