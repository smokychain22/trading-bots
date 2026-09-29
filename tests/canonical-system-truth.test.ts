import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalBrainLayers, canonicalSystemTruthRegister, canonicalSystemCapabilities,
} from '../src/theta/canonical-system-truth.js';

test('canonical truth register covers each brain layer with named source and honest release separation', () => {
  assert.equal(canonicalBrainLayers.length, 21);
  assert.equal(canonicalSystemTruthRegister.brainLayers.length, 21);
  assert.equal(canonicalSystemTruthRegister.auditCoverage, 'COMPLETE');
  assert.equal(canonicalSystemTruthRegister.coverageMeaning, 'CORE_CAPABILITY_AND_21_LAYER_COVERAGE');
  assert.equal(canonicalSystemTruthRegister.deepInventoryAuthority, 'npm run theta:truth:deep-inventory');
  assert.equal('observedWorkerSha' in canonicalSystemTruthRegister, false);
  assert.equal(canonicalSystemTruthRegister.brokerMutationsAuthorized, false);
  assert.equal(canonicalSystemTruthRegister.followerExecutionAuthorized, false);
  assert.equal(canonicalSystemTruthRegister.liveMoneyAuthorized, false);
  for (const [index, layer] of canonicalSystemTruthRegister.brainLayers.entries()) {
    assert.equal(layer.layerId, index);
    assert.equal(layer.name, canonicalBrainLayers[index]);
    assert.ok(layer.capabilityIds.length > 0, `L${index} has no mapped capability`);
  }
  const ids = canonicalSystemCapabilities.map((item) => item.capabilityId);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of canonicalSystemCapabilities) {
    assert.ok(item.currentBlocker.trim() && item.safeCurrentBehavior.trim() && item.closureTest.trim());
    assert.match(item.lastVerifiedSha, /^[0-9a-f]{40}$/);
    assert.ok(item.sourceFiles.length > 0);
    for (const file of item.sourceFiles) assert.ok(existsSync(file), `${item.capabilityId}: missing ${file}`);
    for (const layerId of item.layerIds) assert.ok(layerId >= 0 && layerId < 21);
    if (item.paperAuthorized === 'NO') assert.equal(item.lockedWorkerObserved, 'NO');
    if (item.empiricallyValidated === 'YES') assert.equal(item.oosValidated, 'YES');
  }
});

test('superseded research claims do not become current authority', () => {
  const router = canonicalSystemCapabilities.find((item) => item.capabilityId === 'STRATEGY_H_D_SHADOW');
  const management = canonicalSystemCapabilities.find((item) => item.capabilityId === 'CANONICAL_MANAGEMENT');
  const aegis = canonicalSystemCapabilities.find((item) => item.capabilityId === 'AEGIS_STRESS_AND_PORTFOLIO');
  assert.ok(router?.supersededClaims.some((claim) => claim.includes('no H/D')));
  assert.ok(management?.supersededClaims.some((claim) => claim.includes('no roll')));
  assert.ok(aegis?.supersededClaims.some((claim) => claim.includes('permanently null')));
  assert.equal(aegis?.disposition, 'BUILT_AWAITING_RUNTIME_PROOF');
  const optionomics = canonicalSystemCapabilities.find((item) => item.capabilityId === 'OPTIONOMICS_RESEARCH_DATA');
  assert.ok(optionomics?.supersededClaims.some((claim) => claim.includes('executable-price authority')));
});

test('first Paper truth separates the deployed release from reviewed integration source', () => {
  const readiness = canonicalSystemCapabilities.find((item) => item.capabilityId === 'FIRST_PAPER_READINESS');
  assert.match(readiness?.currentBlocker ?? '', /cf9bc26a3cdd3646a663fe6fa97c8055606a2caa/i);
  assert.match(readiness?.currentBlocker ?? '', /ff7d4ec2432637851d9ff8304af0661e39b06c62/i);
  assert.match(readiness?.currentBlocker ?? '', /is not deployed/i);
  assert.doesNotMatch(readiness?.currentBlocker ?? '', /worker is intentionally stopped/i);
  assert.doesNotMatch(readiness?.currentBlocker ?? '', /transfer quota/i);
  assert.equal(readiness?.disposition, 'TRUE_HARD_BLOCKER');
});

test('AEGIS truth distinguishes its migration-origin evidence contract from the current schema head', () => {
  const aegis = canonicalSystemCapabilities.find((item) => item.capabilityId === 'AEGIS_STRESS_AND_PORTFOLIO');
  assert.match(aegis?.currentBlocker ?? '', /migration-064-origin/i);
  assert.match(aegis?.currentBlocker ?? '', /schema head 067/i);
  assert.doesNotMatch(aegis?.closureTest ?? '', /schema-064 assessments/i);
});
