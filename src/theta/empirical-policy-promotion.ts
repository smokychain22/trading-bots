import { z } from 'zod';

export const empiricalPolicyPromotionContractVersion = 'theta-empirical-policy-promotion-v1' as const;

const finiteMetric = z.number().finite();
const nullableMetric = finiteMetric.nullable();
const evidenceWindowSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
}).strict();

export const empiricalPolicyPromotionReceiptSchema = z.object({
  contractVersion: z.literal(empiricalPolicyPromotionContractVersion),
  policyKind: z.enum(['MANAGEMENT', 'STRATEGY_ROUTER']),
  policyVersion: z.string().min(1),
  datasetVersion: z.string().min(1),
  datasetHash: z.string().regex(/^[0-9a-f]{64}$/),
  featureSetVersion: z.string().min(1),
  strategyVersions: z.array(z.string().min(1)).min(1),
  trainWindow: evidenceWindowSchema,
  validationWindow: evidenceWindowSchema,
  outOfSampleWindow: evidenceWindowSchema,
  embargoDays: z.number().int().nonnegative(),
  metrics: z.object({
    effectiveIndependentN: nullableMetric,
    managedEpisodeWinRate: nullableMetric,
    wholeChainWinRate: nullableMetric,
    afterCostExpectedValue: nullableMetric,
    profitFactor: nullableMetric,
    averageWin: nullableMetric,
    averageLoss: nullableMetric,
    maxDrawdown: nullableMetric,
    expectedShortfall: nullableMetric,
    capitalDays: nullableMetric,
    brierScore: nullableMetric,
    realizedSlippage: nullableMetric,
    deflatedSharpeRatio: nullableMetric,
    probabilityOfBacktestOverfitting: nullableMetric,
  }).strict(),
  acceptanceCriteriaVersion: z.string().min(1),
  acceptanceCriteria: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    passed: z.boolean(),
    evidenceReference: z.string().min(1).nullable(),
  }).strict()).min(1),
  executionEvidence: z.enum(['PROVEN', 'NOT_PROVEN']),
  approval: z.enum(['NOT_REQUESTED', 'APPROVED', 'REJECTED']),
}).strict();

export type EmpiricalPolicyPromotionReceipt = z.infer<typeof empiricalPolicyPromotionReceiptSchema>;

export interface EmpiricalPolicyPromotionAssessment {
  readonly contractVersion: typeof empiricalPolicyPromotionContractVersion;
  readonly readyForHumanPromotionReview: boolean;
  readonly promoted: false;
  readonly executionAuthorized: false;
  readonly blockers: readonly string[];
}

/**
 * Validates the evidence package only. Promotion remains an explicit human and
 * production integration action, so this contract can never authorize orders.
 */
export function assessEmpiricalPolicyPromotion(
  raw: unknown,
): EmpiricalPolicyPromotionAssessment {
  const parsed = empiricalPolicyPromotionReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      contractVersion: empiricalPolicyPromotionContractVersion,
      readyForHumanPromotionReview: false,
      promoted: false,
      executionAuthorized: false,
      blockers: ['PROMOTION_RECEIPT_INVALID'],
    };
  }

  const receipt = parsed.data;
  const blockers: string[] = [];
  const trainEnd = Date.parse(receipt.trainWindow.end);
  const validationStart = Date.parse(receipt.validationWindow.start);
  const validationEnd = Date.parse(receipt.validationWindow.end);
  const oosStart = Date.parse(receipt.outOfSampleWindow.start);
  const embargoMilliseconds = receipt.embargoDays * 86_400_000;

  if (Date.parse(receipt.trainWindow.start) >= trainEnd) blockers.push('TRAIN_WINDOW_INVALID');
  if (validationStart >= validationEnd) blockers.push('VALIDATION_WINDOW_INVALID');
  if (Date.parse(receipt.outOfSampleWindow.start) >= Date.parse(receipt.outOfSampleWindow.end)) {
    blockers.push('OUT_OF_SAMPLE_WINDOW_INVALID');
  }
  if (validationStart < trainEnd + embargoMilliseconds) blockers.push('TRAIN_VALIDATION_EMBARGO_FAILED');
  if (oosStart < validationEnd + embargoMilliseconds) blockers.push('VALIDATION_OOS_EMBARGO_FAILED');

  const requiredMetrics: ReadonlyArray<keyof typeof receipt.metrics> = [
    'effectiveIndependentN', 'managedEpisodeWinRate', 'wholeChainWinRate',
    'afterCostExpectedValue', 'profitFactor', 'averageWin', 'averageLoss',
    'maxDrawdown', 'expectedShortfall', 'capitalDays', 'brierScore', 'realizedSlippage',
  ];
  for (const metric of requiredMetrics) {
    if (receipt.metrics[metric] === null) blockers.push(`METRIC_${metric.toUpperCase()}_UNKNOWN`);
  }
  if (receipt.acceptanceCriteria.some((criterion) => !criterion.passed || criterion.evidenceReference === null)) {
    blockers.push('ACCEPTANCE_CRITERIA_NOT_PROVEN');
  }
  if (receipt.executionEvidence !== 'PROVEN') blockers.push('EXECUTION_EVIDENCE_NOT_PROVEN');
  if (receipt.approval !== 'APPROVED') blockers.push('HUMAN_APPROVAL_NOT_GRANTED');

  return {
    contractVersion: empiricalPolicyPromotionContractVersion,
    readyForHumanPromotionReview: blockers.length === 0,
    promoted: false,
    executionAuthorized: false,
    blockers: [...new Set(blockers)].sort(),
  };
}
