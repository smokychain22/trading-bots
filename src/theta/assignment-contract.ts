import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/assignment_model.py (R1H item K1). TypeScript
// never recomputes economic_basis_per_share/mechanical_close_realized_pnl
// itself -- Python quant is mathematical policy truth. This file only
// validates and types what Python returns.
//
// This contract deliberately reports ONLY the economic/ownership
// recommendation assignment_model.py itself computes. Required
// cash/collateral, resulting share quantity, and post-assignment
// concentration are account-exposure quantities already derived in
// account-exposure.ts -- assignment-assembly.ts combines both into the
// final receipt rather than duplicating that math here.

export const assignmentContractVersion = 'theta-assignment-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const recommendationSchema = z.enum(['ACCEPT_ASSIGNMENT', 'CLOSE_STOCK', 'UNKNOWN']);

export const assignmentEvaluationResponseSchema = z.object({
  contractVersion: z.literal(assignmentContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  fusionSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  ownershipAcceptable: z.boolean().nullable(),
  economicBasisPerShare: z.number().finite(),
  mechanicalCloseRealizedPnl: z.number().finite().nullable(),
  acceptAssignmentTailPenalty: z.number().finite().nullable(),
  recommendation: recommendationSchema,
  reasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  if (response.recommendation === 'ACCEPT_ASSIGNMENT' && response.ownershipAcceptable !== true) {
    context.addIssue({ code: 'custom', message: 'ACCEPT_ASSIGNMENT requires ownershipAcceptable to be true' });
  }
});

export type AssignmentEvaluationResponse = z.infer<typeof assignmentEvaluationResponseSchema>;

export function parseAssignmentEvaluationResponse(
  payload: unknown,
  expectedFusionSnapshotHash: string,
): AssignmentEvaluationResponse {
  const response = assignmentEvaluationResponseSchema.parse(payload);
  if (response.fusionSnapshotHash !== expectedFusionSnapshotHash) {
    throw new Error('Assignment evaluation response belongs to a different FusionSnapshot');
  }
  return response;
}
