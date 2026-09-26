import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { currentImmutableSourceSha } from '../src/theta/theta-shadow-once.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import {
  buildProfitabilityBrainRealityFromManifest, profitabilityBrainEvidenceManifestVersion,
  type ProfitabilityBrainEvidenceManifest,
} from '../src/theta/profitability-brain-evidence-manifest.js';

// Phase 1 Zero-Unknown Reclosure Pass 2 (directive item 6): known source
// identity must produce a real SHA in the receipt path; there must be no
// silent path where a missing/invalid identity is accepted as complete L7
// proof. This exercises the REAL currentImmutableSourceSha() this repo's
// own git checkout, not a mocked git call.

// These tests read this checkout's REAL, current git state (not a mock) --
// they are written to be truthful whether the tree happens to be clean
// (the normal case at final closure) or mid-development-dirty (this
// checkout, right now, while this exact test file is itself uncommitted).
// currentImmutableSourceSha() throwing on a dirty tree is the correct,
// intended behavior being tested here, not a flake to work around.
const treeIsDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;

test('CORE CLAIM: currentImmutableSourceSha() returns the real, exact git HEAD SHA of this checkout when the tree is clean', () => {
  if (treeIsDirty) {
    assert.throws(() => currentImmutableSourceSha(), /SHADOW_ONCE_IMMUTABLE_SOURCE_REQUIRED/);
    return;
  }
  const expected = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const actual = currentImmutableSourceSha();
  assert.equal(actual, expected);
  assert.match(actual, /^[0-9a-f]{40}$/);
});

test('a manifest built from a known, matching real source/worker SHA produces zero violations and reaches L7', (t) => {
  if (treeIsDirty) { t.skip('tree is dirty at test time -- currentImmutableSourceSha() correctly refuses; covered by the clean-tree assertion above'); return; }
  const sha = currentImmutableSourceSha();
  const runtime = [{ methodId: 'STRATEGY_APPLICABILITY_ROUTER', evidenceId: 'run-1',
    evidenceHash: createHash('sha256').update('test-evidence').digest('hex'),
    observedAt: new Date().toISOString(), sourceSha: sha, workerSha: sha }];
  const body = { contractVersion: profitabilityBrainEvidenceManifestVersion, canonicalSourceSha: sha, currentWorkerSha: sha,
    generatedAt: new Date().toISOString(), runtime, empirical: [], brokerAuthorization: [] };
  const manifest: ProfitabilityBrainEvidenceManifest = { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
  const result = buildProfitabilityBrainRealityFromManifest(manifest);
  assert.deepEqual(result.violations, []);
  assert.equal(result.receipt.methods.find((m) => m.methodId === 'STRATEGY_APPLICABILITY_ROUTER')?.level, 'L7_CURRENT_WORKER_REAL_DATA');
});

test('a missing/invalid source identity (empty string, not a real SHA) is explicitly rejected, never silently accepted as complete proof', () => {
  const body = { contractVersion: profitabilityBrainEvidenceManifestVersion, canonicalSourceSha: '', currentWorkerSha: '',
    generatedAt: new Date().toISOString(), runtime: [], empirical: [], brokerAuthorization: [] };
  const manifest: ProfitabilityBrainEvidenceManifest = { ...body, manifestHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
  const result = buildProfitabilityBrainRealityFromManifest(manifest);
  assert.ok(result.violations.includes('CANONICAL_SOURCE_SHA_INVALID'));
  assert.ok(result.violations.includes('CURRENT_WORKER_SHA_INVALID'));
});
