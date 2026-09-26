/**
 * OVERNIGHT WAVE §40: the promotion-evidence assembler. Research-only,
 * `brokerAuthority: false`. This module NEVER promotes a model -- it does
 * not write `promotionState`, does not call `ResearchDurableStore`, and
 * has no import path into any Production/decision-authority module. It
 * only ASSEMBLES a real evidence checklist and REFUSES eligibility unless
 * every required item is genuinely present.
 *
 * "Eligible" here means "a human reviewer now has a complete, honestly-
 * assembled evidence package to review" -- it is never itself an
 * authorization, and the assembler's own output type has no field that
 * could be mistaken for one (no `approved`, no `promoted`).
 */
import type { ModelRegistryRecord } from './empirical-model-registry.js';
import type { SelectionBiasReceipt } from './selection-bias-receipt.js';
import type { CalibrationEvaluationReceipt } from './calibration-evaluation-contract.js';

export const promotionEvidenceAssemblerVersion = 'theta-promotion-evidence-assembler-v1' as const;

export type PromotionEvidenceRequirement =
  | 'REAL_EMPIRICAL_PROVENANCE' | 'INDEPENDENT_N_MEETS_GATE' | 'PIT_VALIDATION_PASS'
  | 'PURGED_WALK_FORWARD_PASS' | 'UNTOUCHED_OOS_PASS' | 'CALIBRATION_PRESENT'
  | 'AFTER_COST_METRICS_PRESENT' | 'TAIL_METRICS_PRESENT' | 'EXECUTION_REALISM_PRESENT'
  | 'SELECTION_BIAS_RECEIPT_PRESENT' | 'MODEL_ARTIFACT_HASH_PRESENT';

export interface PromotionEvidenceInput {
  readonly model: ModelRegistryRecord;
  readonly calibrationReceipt: CalibrationEvaluationReceipt | null;
  readonly selectionBiasReceipt: SelectionBiasReceipt | null;
  readonly pitValidationPassed: boolean;
  readonly purgedWalkForwardPassed: boolean;
  readonly untouchedOosPassed: boolean;
  readonly afterCostMetricsPresent: boolean;
  readonly tailMetricsPresent: boolean;
  readonly executionRealismPresent: boolean;
  readonly minimumIndependentN: number;
}

export interface PromotionEvidenceAssembly {
  readonly contractVersion: typeof promotionEvidenceAssemblerVersion;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly satisfied: readonly PromotionEvidenceRequirement[];
  readonly missing: readonly PromotionEvidenceRequirement[];
  readonly eligibleForReview: boolean;
  readonly assembledAt: string;
}

/**
 * Assembles the real evidence checklist and refuses `eligibleForReview`
 * unless EVERY requirement is genuinely satisfied. Never returns
 * `eligibleForReview: true` from a partial checklist -- there is no
 * "mostly ready" state in this contract, matching the directive's own
 * instruction that this module ONLY assembles/refuses, never grades.
 */
export function assemblePromotionEvidence(input: PromotionEvidenceInput, assembledAt: string): PromotionEvidenceAssembly {
  const checks: readonly { readonly requirement: PromotionEvidenceRequirement; readonly satisfied: boolean }[] = [
    { requirement: 'REAL_EMPIRICAL_PROVENANCE', satisfied: input.model.datasetId.length > 0 && input.model.datasetHash.length > 0 },
    { requirement: 'INDEPENDENT_N_MEETS_GATE', satisfied: (input.model.metrics.independentN ?? 0) >= input.minimumIndependentN },
    { requirement: 'PIT_VALIDATION_PASS', satisfied: input.pitValidationPassed },
    { requirement: 'PURGED_WALK_FORWARD_PASS', satisfied: input.purgedWalkForwardPassed },
    { requirement: 'UNTOUCHED_OOS_PASS', satisfied: input.untouchedOosPassed && input.model.finalOosWindow !== null },
    {
      requirement: 'CALIBRATION_PRESENT',
      satisfied: input.calibrationReceipt !== null && input.calibrationReceipt.dataProvenance === 'REAL_EMPIRICAL_DATA',
    },
    { requirement: 'AFTER_COST_METRICS_PRESENT', satisfied: input.afterCostMetricsPresent },
    { requirement: 'TAIL_METRICS_PRESENT', satisfied: input.tailMetricsPresent },
    { requirement: 'EXECUTION_REALISM_PRESENT', satisfied: input.executionRealismPresent },
    {
      requirement: 'SELECTION_BIAS_RECEIPT_PRESENT',
      satisfied: input.selectionBiasReceipt !== null && input.model.selectionBiasReceiptId === input.selectionBiasReceipt.researchCampaignId,
    },
    { requirement: 'MODEL_ARTIFACT_HASH_PRESENT', satisfied: input.model.artifactHash.length > 0 },
  ];

  const satisfied = checks.filter((c) => c.satisfied).map((c) => c.requirement);
  const missing = checks.filter((c) => !c.satisfied).map((c) => c.requirement);

  return {
    contractVersion: promotionEvidenceAssemblerVersion,
    modelId: input.model.modelId, modelVersion: input.model.modelVersion,
    satisfied, missing, eligibleForReview: missing.length === 0, assembledAt,
  };
}
