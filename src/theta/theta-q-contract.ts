import { z } from 'zod';

export const thetaQContractVersion = 'theta-q-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const economicsSchema = z.object({
  max_profit: z.number().finite(),
  break_even_price: z.number().finite(),
  secured_collateral_per_contract: z.number().finite().nonnegative(),
  credit_collateral_ratio: z.number().finite().nonnegative(),
  ev_net: z.number().finite().nullable(),
  ev_net_unknown_reason: z.string().min(1).nullable(),
});

const candidateSchema = z.object({
  candidateId: z.string().min(1),
  rank: z.number().int().positive().nullable(),
  actionFeasible: z.boolean(),
  quantity: z.number().int().nonnegative(),
  economics: economicsSchema.nullable(),
  ownershipScore: z.number().min(0).max(1).nullable(),
  reasons: z.array(reasonSchema),
}).superRefine((candidate, context) => {
  if (!candidate.actionFeasible && candidate.quantity !== 0) {
    context.addIssue({ code: 'custom', message: 'infeasible candidate quantity must be zero' });
  }
});

export const thetaQResponseSchema = z.object({
  contractVersion: z.literal(thetaQContractVersion),
  fusionSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  candidates: z.array(candidateSchema),
  wait: z.object({
    candidateId: z.literal('WAIT'),
    actionFeasible: z.literal(true),
    quantity: z.literal(0),
  }),
  recommendation: z.object({
    actionCode: z.enum(['OPEN_CSP', 'WAIT']),
    selectedCandidateId: z.string().min(1),
    quantity: z.number().int().nonnegative(),
    executionAuthorized: z.literal(false),
    requiresAegis: z.literal(true),
    requiresFreshAlpacaBbo: z.literal(true),
  }),
}).superRefine((response, context) => {
  const ids = response.candidates.map((candidate) => candidate.candidateId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'candidateId values must be unique' });
  }
  if (response.recommendation.actionCode === 'WAIT') {
    if (response.recommendation.selectedCandidateId !== 'WAIT' || response.recommendation.quantity !== 0) {
      context.addIssue({ code: 'custom', message: 'WAIT must select WAIT with quantity zero' });
    }
    return;
  }
  const selected = response.candidates.find(
    (candidate) => candidate.candidateId === response.recommendation.selectedCandidateId,
  );
  if (!selected?.actionFeasible || selected.quantity !== response.recommendation.quantity) {
    context.addIssue({ code: 'custom', message: 'OPEN_CSP must select a feasible persisted candidate' });
  }
});

export type ThetaQResponse = z.infer<typeof thetaQResponseSchema>;

export function parseThetaQResponse(payload: unknown, expectedFusionSnapshotHash: string): ThetaQResponse {
  const response = thetaQResponseSchema.parse(payload);
  if (response.fusionSnapshotHash !== expectedFusionSnapshotHash) {
    throw new Error('THETA-Q response belongs to a different FusionSnapshot');
  }
  return response;
}
