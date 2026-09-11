import { z } from 'zod';

export const decisionEvidenceVersion = 'theta-decision-evidence-v1' as const;

export const hardGateCode = z.enum([
  'BROKER_DATA_INVALID',
  'BROKER_DATA_STALE',
  'UNSUPPORTED_SESSION',
  'INVALID_CONTRACT',
  'MULTIPLIER_UNKNOWN',
  'EXECUTABLE_QUOTE_UNAVAILABLE',
  'QUANTITY_ZERO',
  'COLLATERAL_INSUFFICIENT',
  'ASSIGNMENT_CAPACITY_INSUFFICIENT',
  'AEGIS_HARD_VETO',
  'ACCOUNT_STATE_INCOMPATIBLE',
  'LIFECYCLE_TRUTH_BROKEN',
  'IDEMPOTENCY_CONFLICT',
]);

export const softEvidenceFamily = z.enum([
  'RSI', 'TREND', 'MOMENTUM', 'IV', 'SKEW', 'TERM_STRUCTURE', 'FLOW',
  'VOLUME_OPEN_INTEREST', 'EVENT_CONTEXT', 'OWNERSHIP', 'REGIME',
]);

export const evidenceState = z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']);

export const decisionEvidenceItemSchema = z.object({
  family: z.string().min(1),
  category: z.enum(['HARD_GATE', 'SOFT_EVIDENCE']),
  code: z.string().min(1),
  state: evidenceState,
  value: z.unknown(),
  provenance: z.object({
    provider: z.string().min(1),
    operationAlias: z.string().min(1),
    asOf: z.string().datetime({ offset: true }).nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
  }),
});

export type DecisionEvidenceItem = z.infer<typeof decisionEvidenceItemSchema>;
export type HardGateCode = z.infer<typeof hardGateCode>;

export const globalWaitReason = z.enum([
  'NO_POSITIVE_AFTER_COST_EV',
  'NO_RISK_FEASIBLE_CANDIDATE',
  'CAPITAL_UNAVAILABLE',
  'HARD_AEGIS_VETO',
  'DATA_INSUFFICIENT',
  'UNSUPPORTED_SESSION',
  'EXECUTION_NOT_FEASIBLE',
]);

export interface GlobalWaitEvidence {
  readonly reason: z.infer<typeof globalWaitReason>;
  readonly eligibleUnderlyingCount: number;
  readonly underlyingsEvaluated: number;
  readonly contractsEvaluated: number;
  readonly validatedBranchesEligible: readonly string[];
  readonly validatedBranchesEvaluated: readonly string[];
  readonly existingPositionManagementEvaluated: boolean;
  readonly recoveryOpportunitiesEvaluated: boolean;
  readonly coveredCallOpportunitiesEvaluated: boolean;
  readonly redeploymentAlternativesEvaluated: boolean;
  readonly hardGateCounts: Readonly<Partial<Record<HardGateCode, number>>>;
  readonly softEvidenceFamiliesObserved: readonly z.infer<typeof softEvidenceFamily>[];
}

export interface GlobalWaitValidation {
  readonly earned: boolean;
  readonly violations: readonly string[];
}

/** A global WAIT is valid only after the currently eligible search surface was exhausted. */
export function validateGlobalWaitEvidence(input: GlobalWaitEvidence): GlobalWaitValidation {
  const violations: string[] = [];
  if (!Number.isInteger(input.eligibleUnderlyingCount) || input.eligibleUnderlyingCount < 0) {
    violations.push('ELIGIBLE_UNDERLYING_COUNT_INVALID');
  }
  if (input.underlyingsEvaluated !== input.eligibleUnderlyingCount) {
    violations.push('ELIGIBLE_UNIVERSE_NOT_EXHAUSTED');
  }
  if (!Number.isInteger(input.contractsEvaluated) || input.contractsEvaluated < 0) {
    violations.push('CONTRACT_COUNT_INVALID');
  }
  const evaluated = new Set(input.validatedBranchesEvaluated);
  if (input.validatedBranchesEligible.some((branch) => !evaluated.has(branch))) {
    violations.push('VALIDATED_BRANCHES_NOT_EXHAUSTED');
  }
  if (!input.existingPositionManagementEvaluated) violations.push('MANAGEMENT_FRONTIER_NOT_EVALUATED');
  if (!input.recoveryOpportunitiesEvaluated) violations.push('RECOVERY_FRONTIER_NOT_EVALUATED');
  if (!input.coveredCallOpportunitiesEvaluated) violations.push('COVERED_CALL_FRONTIER_NOT_EVALUATED');
  if (!input.redeploymentAlternativesEvaluated) violations.push('REDEPLOYMENT_FRONTIER_NOT_EVALUATED');
  return { earned: violations.length === 0, violations };
}

export function splitDecisionEvidence(items: readonly DecisionEvidenceItem[]): {
  readonly hardBlockers: readonly DecisionEvidenceItem[];
  readonly softEvidence: readonly DecisionEvidenceItem[];
} {
  const parsed = items.map((item) => decisionEvidenceItemSchema.parse(item));
  return {
    hardBlockers: parsed.filter((item) => item.category === 'HARD_GATE' && item.state !== 'GOOD'),
    softEvidence: parsed.filter((item) => item.category === 'SOFT_EVIDENCE'),
  };
}
