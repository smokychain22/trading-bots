import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/execution_quality.py.

export const executionQualityContractVersion = 'theta-execution-quality-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const executionQualityResponseSchema = z.object({
  contractVersion: z.literal(executionQualityContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  spreadPct: z.number().finite().nullable(),
  fillProbability: z.number().min(0).max(1).nullable(),
  expectedSlippagePerShare: z.number().finite().nullable(),
  acceptable: z.boolean().nullable(),
  recommendedAction: z.enum(['SUBMIT', 'SKIP', 'CANCEL', 'UNKNOWN']),
  reasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  if (response.acceptable === null && response.recommendedAction === 'SUBMIT') {
    context.addIssue({ code: 'custom', message: 'SUBMIT must never be recommended when acceptability is UNKNOWN' });
  }
  if (response.acceptable === true && response.recommendedAction !== 'SUBMIT') {
    context.addIssue({ code: 'custom', message: 'acceptable=true must recommend SUBMIT' });
  }
});

export type ExecutionQualityResponse = z.infer<typeof executionQualityResponseSchema>;

export function parseExecutionQualityResponse(payload: unknown): ExecutionQualityResponse {
  return executionQualityResponseSchema.parse(payload);
}
