export const managementPolicyPromotionLadderVersion = 'theta-management-policy-promotion-ladder-v1' as const;

/**
 * The promotion ladder for a candidate (empirically-learned) management
 * policy that wants to eventually replace/augment PAPER_BOOTSTRAP_MANAGEMENT_POLICY.
 * The bootstrap policy itself never appears in this ladder -- it is always
 * active as the safe default and is not "promoted."
 *
 * BOOTSTRAP_PAPER: no shadow evidence yet for this candidate. Only the
 *   deterministic bootstrap policy acts.
 * SHADOW_CHALLENGER: the candidate is evaluated on every real decision
 *   point but NEVER selects a broker action -- pure observation.
 * PAPER_CANDIDATE: the candidate has accumulated enough shadow evidence to
 *   be allowed to act in Paper (still small-sample, still not the default).
 * PAPER_CHAMPION: the candidate has real, realized (not forecasted)
 *   after-cost utility over enough acting episodes, calibration is
 *   acceptable, and (if required) out-of-sample validation and human
 *   review are both satisfied.
 *
 * `liveEligible` is hardcoded `false` and cannot be set true by any
 * evidence this module accepts. Live-money authorization is a human
 * graduation-gate decision (TRD gates G1-G7), never a code-computed one --
 * this ladder governs Paper-only promotion.
 */
export type ManagementPolicyPromotionState =
  'BOOTSTRAP_PAPER' | 'SHADOW_CHALLENGER' | 'PAPER_CANDIDATE' | 'PAPER_CHAMPION';

export interface ManagementPolicyPromotionEvidence {
  readonly candidatePolicyVersion: string;
  /** Episodes where the candidate was evaluated but did not act. */
  readonly shadowComparisonEpisodes: number;
  /** Episodes where the candidate actually selected the executed action (a subset of Paper activity). */
  readonly candidateActingEpisodes: number;
  /** Realized, after-cost utility over `candidateActingEpisodes` -- null if not yet computed from real fills. */
  readonly realizedAfterCostUtility: number | null;
  readonly calibrationBrierScore: number | null;
  readonly calibrationSampleSize: number;
  readonly outOfSampleValidated: boolean;
  readonly humanReviewApproved: boolean;
}

/**
 * Every threshold is caller-supplied and must be justified by the caller --
 * this module never invents a "reasonable" sample size or score threshold.
 */
export interface ManagementPolicyPromotionThresholds {
  readonly minShadowEpisodesForCandidate: number;
  readonly minActingEpisodesForChampion: number;
  readonly minCalibrationSampleSize: number;
  readonly maxAcceptableBrierScore: number;
  readonly requireOutOfSampleValidation: boolean;
  readonly requireHumanReview: boolean;
}

export interface ManagementPolicyPromotionAssessment {
  readonly contractVersion: typeof managementPolicyPromotionLadderVersion;
  readonly state: ManagementPolicyPromotionState;
  readonly liveEligible: false;
  readonly reasons: readonly string[];
  readonly blockers: readonly string[];
}

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`MANAGEMENT_POLICY_PROMOTION_INVALID_THRESHOLD:${name}`);
}

function validateThresholds(thresholds: ManagementPolicyPromotionThresholds): void {
  requirePositive(thresholds.minShadowEpisodesForCandidate, 'minShadowEpisodesForCandidate');
  requirePositive(thresholds.minActingEpisodesForChampion, 'minActingEpisodesForChampion');
  requirePositive(thresholds.minCalibrationSampleSize, 'minCalibrationSampleSize');
  requirePositive(thresholds.maxAcceptableBrierScore, 'maxAcceptableBrierScore');
}

/**
 * Fails safe throughout: any missing/UNKNOWN required evidence field
 * blocks promotion to the next rung rather than being treated as passing.
 * The function never raises the state further than the evidence honestly
 * supports.
 */
export function evaluateManagementPolicyPromotion(
  evidence: ManagementPolicyPromotionEvidence, thresholds: ManagementPolicyPromotionThresholds,
): ManagementPolicyPromotionAssessment {
  validateThresholds(thresholds);
  const blockers: string[] = [];
  const reasons: string[] = [`CANDIDATE_POLICY_${evidence.candidatePolicyVersion}`];

  if (evidence.shadowComparisonEpisodes <= 0) {
    return {
      contractVersion: managementPolicyPromotionLadderVersion, state: 'BOOTSTRAP_PAPER', liveEligible: false,
      reasons: [...reasons, 'NO_SHADOW_EVIDENCE_YET'], blockers: ['NO_SHADOW_EVIDENCE_YET'],
    };
  }

  if (evidence.shadowComparisonEpisodes < thresholds.minShadowEpisodesForCandidate) {
    blockers.push(`SHADOW_EPISODES_BELOW_CANDIDATE_THRESHOLD:${evidence.shadowComparisonEpisodes}/${thresholds.minShadowEpisodesForCandidate}`);
    return {
      contractVersion: managementPolicyPromotionLadderVersion, state: 'SHADOW_CHALLENGER', liveEligible: false,
      reasons, blockers,
    };
  }

  // Eligible for PAPER_CANDIDATE. Evaluate every champion criterion; any
  // missing/failing one keeps the candidate at PAPER_CANDIDATE and names
  // exactly what is still missing (never silently withheld).
  if (evidence.candidateActingEpisodes < thresholds.minActingEpisodesForChampion) {
    blockers.push(`ACTING_EPISODES_BELOW_CHAMPION_THRESHOLD:${evidence.candidateActingEpisodes}/${thresholds.minActingEpisodesForChampion}`);
  }
  if (evidence.calibrationSampleSize < thresholds.minCalibrationSampleSize) {
    blockers.push(`CALIBRATION_SAMPLE_BELOW_THRESHOLD:${evidence.calibrationSampleSize}/${thresholds.minCalibrationSampleSize}`);
  }
  if (evidence.calibrationBrierScore === null) {
    blockers.push('CALIBRATION_BRIER_SCORE_UNKNOWN');
  } else if (evidence.calibrationBrierScore > thresholds.maxAcceptableBrierScore) {
    blockers.push(`CALIBRATION_BRIER_SCORE_TOO_HIGH:${evidence.calibrationBrierScore}/${thresholds.maxAcceptableBrierScore}`);
  }
  if (evidence.realizedAfterCostUtility === null) {
    blockers.push('REALIZED_AFTER_COST_UTILITY_UNKNOWN');
  } else if (evidence.realizedAfterCostUtility <= 0) {
    blockers.push(`REALIZED_AFTER_COST_UTILITY_NOT_POSITIVE:${evidence.realizedAfterCostUtility}`);
  }
  if (thresholds.requireOutOfSampleValidation && !evidence.outOfSampleValidated) {
    blockers.push('OUT_OF_SAMPLE_VALIDATION_REQUIRED_AND_MISSING');
  }
  if (thresholds.requireHumanReview && !evidence.humanReviewApproved) {
    blockers.push('HUMAN_REVIEW_REQUIRED_AND_MISSING');
  }

  if (blockers.length > 0) {
    return {
      contractVersion: managementPolicyPromotionLadderVersion, state: 'PAPER_CANDIDATE', liveEligible: false,
      reasons, blockers,
    };
  }
  return {
    contractVersion: managementPolicyPromotionLadderVersion, state: 'PAPER_CHAMPION', liveEligible: false,
    reasons: [...reasons, 'ALL_CHAMPION_CRITERIA_MET'], blockers: [],
  };
}
