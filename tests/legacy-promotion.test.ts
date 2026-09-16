import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesLegacyPromotionConfirmation,
  validateLegacyFamilyPayload,
} from '../src/database/legacy-promotion.js';

const id = '00000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);

test('legacy promotion requires its exact bounded confirmation', () => {
  assert.equal(matchesLegacyPromotionConfirmation('AIVEN_LEGACY_PROMOTE_051'), true);
  assert.equal(matchesLegacyPromotionConfirmation('AIVEN_BOOTSTRAP_050'), false);
  assert.equal(matchesLegacyPromotionConfirmation(['AIVEN_LEGACY_PROMOTE_051']), false);
  assert.equal(matchesLegacyPromotionConfirmation(undefined), false);
});

test('legacy promotion accepts structurally valid PIT candidate-set evidence', () => {
  assert.deepEqual(validateLegacyFamilyPayload('candidateSets', {
    candidateSetId:id, decisionTime:'2026-09-15T15:00:00.000Z', universeEvaluated:[], branchesConsidered:[],
    counts:{}, contentHash:hash,
  }, 'ELIGIBLE', 'REAL_PRODUCTION_EVIDENCE'), []);
});

test('legacy promotion blocks future-action authority and invalid provenance', () => {
  const errors = validateLegacyFamilyPayload('outcomeSubjects', {
    outcomeSubjectId:id, subjectId:'subject', labelType:'WAIT_OUTCOME', decisionTimestamp:'2026-09-15T15:00:00.000Z',
    horizonId:'1D', contentHash:hash, executionAuthorized:true,
  }, 'UNKNOWN', 'SYNTHETIC');
  assert.ok(errors.includes('PIT_NOT_ELIGIBLE'));
  assert.ok(errors.includes('NON_REAL_EVIDENCE_CLASS'));
  assert.ok(errors.includes('EXECUTION_AUTHORIZED_NOT_FALSE'));
});

test('legacy promotion rejects unsupported families', () => {
  assert.deepEqual(validateLegacyFamilyPayload('unknownFamily', {}, 'ELIGIBLE', 'REAL_PRODUCTION_EVIDENCE'),
    ['UNSUPPORTED_SOURCE_FAMILY']);
});
