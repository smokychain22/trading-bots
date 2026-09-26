import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntegrationManifest, type IntegrationManifestInput } from '../src/research/integration-manifest.js';

function input(overrides: Partial<IntegrationManifestInput> = {}): IntegrationManifestInput {
  return {
    researchHeadSha: 'head-1', baseMainSha: 'main-1', requiredMainMinimumSha: 'main-1', filesChanged: ['src/research/x.ts'],
    nodeTestResult: { suite: 'NODE', passed: 2560, total: 2560, skipped: 14 },
    pythonTestResult: { suite: 'PYTHON', passed: 685, total: 685, skipped: 0 },
    typecheckPassed: true, lintPassed: true, securityScanFindings: 0,
    ...overrides,
  };
}

test('CORE CLAIM: productionFilesChangedByClaude is always the empty tuple, never caller-supplied', () => {
  const manifest = buildIntegrationManifest(input());
  assert.deepEqual(manifest.productionFilesChangedByClaude, []);
});

test('a fully green build with no open Claude-solvable blockers is READY_FOR_CODEX_REVIEW', () => {
  const manifest = buildIntegrationManifest(input());
  assert.equal(manifest.state, 'READY_FOR_CODEX_REVIEW');
});

test('CORE CLAIM: a failing test suite forces EXTERNAL_BLOCKED, never a fabricated READY state', () => {
  const manifest = buildIntegrationManifest(input({ nodeTestResult: { suite: 'NODE', passed: 2559, total: 2560, skipped: 14 } }));
  assert.equal(manifest.state, 'EXTERNAL_BLOCKED');
});

test('a nonzero security-scan finding forces EXTERNAL_BLOCKED', () => {
  const manifest = buildIntegrationManifest(input({ securityScanFindings: 1 }));
  assert.equal(manifest.state, 'EXTERNAL_BLOCKED');
});

test('open external blockers (Codex-owned) are reported but do not by themselves force EXTERNAL_BLOCKED', () => {
  const manifest = buildIntegrationManifest(input());
  assert.ok(manifest.openExternalBlockers.some((b) => b.issueId === 'THETA-CONTRACT-PATH-RUNTIME-OBSERVATION-PRODUCER'));
  assert.equal(manifest.state, 'READY_FOR_CODEX_REVIEW');
});

test('the required runtime contract version matches the real export-schema-drift-detector expectation', () => {
  const manifest = buildIntegrationManifest(input());
  assert.equal(manifest.requiredRuntimeContracts[0]?.contract, 'postgres-cycle-evidence-storage');
});
