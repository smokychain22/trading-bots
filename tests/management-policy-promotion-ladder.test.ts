import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateManagementPolicyPromotion, type ManagementPolicyPromotionEvidence,
  type ManagementPolicyPromotionThresholds,
} from '../src/theta/management-policy-promotion-ladder.js';

const thresholds: ManagementPolicyPromotionThresholds = {
  minShadowEpisodesForCandidate: 50, minActingEpisodesForChampion: 100,
  minCalibrationSampleSize: 100, maxAcceptableBrierScore: 0.2,
  requireOutOfSampleValidation: true, requireHumanReview: true,
};

const evidence = (overrides: Partial<ManagementPolicyPromotionEvidence> = {}): ManagementPolicyPromotionEvidence => ({
  candidatePolicyVersion: 'candidate-v1', shadowComparisonEpisodes: 0, candidateActingEpisodes: 0,
  realizedAfterCostUtility: null, calibrationBrierScore: null, calibrationSampleSize: 0,
  outOfSampleValidated: false, humanReviewApproved: false, ...overrides,
});

test('no shadow evidence at all stays at BOOTSTRAP_PAPER', () => {
  const result = evaluateManagementPolicyPromotion(evidence(), thresholds);
  assert.equal(result.state, 'BOOTSTRAP_PAPER');
  assert.equal(result.liveEligible, false);
  assert.ok(result.blockers.includes('NO_SHADOW_EVIDENCE_YET'));
});

test('shadow evidence below the candidate threshold stays at SHADOW_CHALLENGER', () => {
  const result = evaluateManagementPolicyPromotion(evidence({ shadowComparisonEpisodes: 10 }), thresholds);
  assert.equal(result.state, 'SHADOW_CHALLENGER');
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('SHADOW_EPISODES_BELOW_CANDIDATE_THRESHOLD')));
});

test('enough shadow episodes but missing champion evidence stays at PAPER_CANDIDATE and names every gap', () => {
  const result = evaluateManagementPolicyPromotion(evidence({ shadowComparisonEpisodes: 60 }), thresholds);
  assert.equal(result.state, 'PAPER_CANDIDATE');
  assert.ok(result.blockers.includes('CALIBRATION_BRIER_SCORE_UNKNOWN'));
  assert.ok(result.blockers.includes('REALIZED_AFTER_COST_UTILITY_UNKNOWN'));
  assert.ok(result.blockers.includes('OUT_OF_SAMPLE_VALIDATION_REQUIRED_AND_MISSING'));
  assert.ok(result.blockers.includes('HUMAN_REVIEW_REQUIRED_AND_MISSING'));
});

test('a negative realized after-cost utility blocks champion promotion even with everything else satisfied', () => {
  const result = evaluateManagementPolicyPromotion(evidence({
    shadowComparisonEpisodes: 60, candidateActingEpisodes: 120, calibrationSampleSize: 150,
    calibrationBrierScore: 0.1, realizedAfterCostUtility: -5, outOfSampleValidated: true, humanReviewApproved: true,
  }), thresholds);
  assert.equal(result.state, 'PAPER_CANDIDATE');
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('REALIZED_AFTER_COST_UTILITY_NOT_POSITIVE')));
});

test('all champion criteria satisfied promotes to PAPER_CHAMPION, still never live-eligible', () => {
  const result = evaluateManagementPolicyPromotion(evidence({
    shadowComparisonEpisodes: 60, candidateActingEpisodes: 120, calibrationSampleSize: 150,
    calibrationBrierScore: 0.1, realizedAfterCostUtility: 25, outOfSampleValidated: true, humanReviewApproved: true,
  }), thresholds);
  assert.equal(result.state, 'PAPER_CHAMPION');
  assert.equal(result.liveEligible, false);
  assert.deepEqual(result.blockers, []);
});

test('invalid (negative) thresholds are rejected rather than silently accepted', () => {
  assert.throws(() => evaluateManagementPolicyPromotion(evidence(), { ...thresholds, minShadowEpisodesForCandidate: -1 }),
    /MANAGEMENT_POLICY_PROMOTION_INVALID_THRESHOLD/);
});
