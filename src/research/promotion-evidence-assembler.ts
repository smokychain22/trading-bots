/**
 * OVERNIGHT WAVE §40: the promotion-evidence assembler. Research-only,
 * `brokerAuthority: false`. This module NEVER promotes a model -- it does
 * not write `promotionState`, does not call `ResearchDurableStore`, and
 * has no import path into any Production/decision-authority module. It
 * only assembles metadata and caller declarations. Those declarations are
 * not executed empirical proof. Canonical policy promotion remains in
 * theta/empirical-policy-promotion.ts, with explicit reviewed governance.
 *
 * Metadata completeness never grants empirical review eligibility or
 * authorization. Executed evidence and canonical governance are separate.
 */
import { validateModelRegistryRecord, type ModelRegistryRecord } from './empirical-model-registry.js';
import { buildSelectionBiasReceipt, type SelectionBiasReceipt } from './selection-bias-receipt.js';
import { validateCalibrationReceipt, type CalibrationEvaluationReceipt } from './calibration-evaluation-contract.js';

export const promotionEvidenceAssemblerVersion = 'theta-promotion-evidence-assembler-v2' as const;

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
  readonly declaredPresent: readonly PromotionEvidenceRequirement[];
  readonly missing: readonly PromotionEvidenceRequirement[];
  readonly metadataComplete: boolean;
  readonly eligibleForReview: false;
  readonly evidenceScope: 'METADATA_AND_CALLER_DECLARATIONS_NOT_EXECUTED_EMPIRICAL_PROOF';
  readonly canonicalPromotionAuthority: 'theta/empirical-policy-promotion.ts';
  readonly assembledAt: string;
}

/**
 * This legacy checklist has no observations, experiment artifacts or resolved
 * provenance to verify caller claims. Report their presence without certifying
 * them. It is not a competing promotion authority.
 */
export function assemblePromotionEvidence(input: PromotionEvidenceInput, assembledAt: string): PromotionEvidenceAssembly {
  validateModelRegistryRecord(input.model);
  if (!Number.isSafeInteger(input.minimumIndependentN) || input.minimumIndependentN <= 0 || !Number.isFinite(Date.parse(assembledAt))) throw new Error('PROMOTION_CHECKLIST_POLICY_OR_TIME_INVALID');
  if (input.calibrationReceipt !== null) validateCalibrationReceipt(input.calibrationReceipt);
  if (input.selectionBiasReceipt !== null) buildSelectionBiasReceipt(input.selectionBiasReceipt);
  const checks: readonly { readonly requirement: PromotionEvidenceRequirement; readonly satisfied: boolean }[] = [
    { requirement: 'REAL_EMPIRICAL_PROVENANCE', satisfied: input.model.datasetId.length > 0 && input.model.datasetHash.length > 0 },
    { requirement: 'INDEPENDENT_N_MEETS_GATE', satisfied: (input.model.metrics.independentN ?? 0) >= input.minimumIndependentN },
    { requirement: 'PIT_VALIDATION_PASS', satisfied: input.pitValidationPassed },
    { requirement: 'PURGED_WALK_FORWARD_PASS', satisfied: input.purgedWalkForwardPassed },
    { requirement: 'UNTOUCHED_OOS_PASS', satisfied: input.untouchedOosPassed && input.model.finalOosWindow !== null },
    {
      requirement: 'CALIBRATION_PRESENT',
      satisfied: input.calibrationReceipt !== null && input.calibrationReceipt.dataProvenance === 'REAL_EMPIRICAL_DATA' &&
        input.calibrationReceipt.modelId === input.model.modelId && input.calibrationReceipt.modelVersion === input.model.modelVersion,
    },
    { requirement: 'AFTER_COST_METRICS_PRESENT', satisfied: input.afterCostMetricsPresent },
    { requirement: 'TAIL_METRICS_PRESENT', satisfied: input.tailMetricsPresent },
    { requirement: 'EXECUTION_REALISM_PRESENT', satisfied: input.executionRealismPresent },
    {
      requirement: 'SELECTION_BIAS_RECEIPT_PRESENT',
      satisfied: input.selectionBiasReceipt !== null && input.model.selectionBiasReceiptId === input.selectionBiasReceipt.researchCampaignId &&
        input.selectionBiasReceipt.inputDatasetHash === input.model.datasetHash && input.selectionBiasReceipt.codeSha === input.model.codeSha &&
        input.selectionBiasReceipt.dependencyGroupingVersion === input.model.dependenceGroupingVersion && input.selectionBiasReceipt.numberOfTrials === input.model.numberOfTrials,
    },
    { requirement: 'MODEL_ARTIFACT_HASH_PRESENT', satisfied: input.model.artifactHash.length > 0 },
  ];

  const satisfied = checks.filter((c) => c.satisfied).map((c) => c.requirement);
  const missing = checks.filter((c) => !c.satisfied).map((c) => c.requirement);

  return {
    contractVersion: promotionEvidenceAssemblerVersion,
    modelId: input.model.modelId, modelVersion: input.model.modelVersion,
    declaredPresent: satisfied, missing, metadataComplete: missing.length === 0, eligibleForReview: false, assembledAt,
    evidenceScope: 'METADATA_AND_CALLER_DECLARATIONS_NOT_EXECUTED_EMPIRICAL_PROOF',
    canonicalPromotionAuthority: 'theta/empirical-policy-promotion.ts',
  };
}
