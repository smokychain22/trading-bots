import { z } from 'zod';
import { thetaStrategyAction, thetaStrategyBranch } from './strategy-package.js';

export const strategyEvaluationContractVersion = 'theta-strategy-evaluation-runtime-v1' as const;
const nullableFinite = z.number().finite().nullable();

export const strategyEvaluationRequestSchema = z.object({
  contractVersion: z.literal(strategyEvaluationContractVersion),
  snapshotId: z.string().min(1),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  strategyVersionId: z.string().min(1),
  eligibleBranches: z.array(thetaStrategyBranch),
  lifecycleState: z.string().min(1),
  candidateIds: z.array(z.string().min(1)),
}).strict();

const candidateEvaluationSchema = z.object({
  candidateId: z.string().min(1),
  branch: thetaStrategyBranch,
  applicable: z.boolean(),
  action: thetaStrategyAction.nullable(),
  expectedAfterCostValue: nullableFinite,
  returnPerCapitalDay: nullableFinite,
  tailRisk: nullableFinite,
  uncertainty: nullableFinite,
  hardBlockers: z.array(z.string()),
  softEvidence: z.array(z.string()),
});

export const strategyEvaluationResponseSchema = z.object({
  contractVersion: z.literal(strategyEvaluationContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  strategyVersionId: z.string().min(1),
  empiricalReadiness: z.literal('EV_MODEL_NOT_EMPIRICALLY_READY'),
  applicableBranches: z.array(thetaStrategyBranch),
  candidateEvaluations: z.array(candidateEvaluationSchema),
  actionValues: z.array(z.object({
    action: thetaStrategyAction,
    expectedAfterCostValue: nullableFinite,
    tailRisk: nullableFinite,
    capitalDays: nullableFinite,
    executionCost: nullableFinite,
    opportunityCost: nullableFinite,
    uncertainty: nullableFinite,
  })),
  selectedAction: thetaStrategyAction.nullable(),
  executionAuthorized: z.literal(false),
}).strict().superRefine((response, context) => {
  if (response.empiricalReadiness === 'EV_MODEL_NOT_EMPIRICALLY_READY') {
    const invented = [...response.candidateEvaluations.map((candidate) => candidate.expectedAfterCostValue),
      ...response.actionValues.map((action) => action.expectedAfterCostValue)].some((value) => value !== null);
    if (invented) context.addIssue({ code: 'custom', message: 'expected value must remain UNKNOWN until the empirical model is ready' });
  }
});

export type StrategyEvaluationRequest = z.infer<typeof strategyEvaluationRequestSchema>;
export type StrategyEvaluationResponse = z.infer<typeof strategyEvaluationResponseSchema>;

export const parseStrategyEvaluationRequest = (payload: unknown): StrategyEvaluationRequest =>
  strategyEvaluationRequestSchema.parse(payload);
export const parseStrategyEvaluationResponse = (payload: unknown): StrategyEvaluationResponse =>
  strategyEvaluationResponseSchema.parse(payload);
