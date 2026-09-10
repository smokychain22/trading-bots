import { z } from 'zod';

// Versioned request/response contract for bots/theta/quant/models/ownership_v0.py.
// Ownability = LiquidityQuality x StructuralQuality x RecoveryQuality x
// TailQuality x EventAdjustment -- component scores are carried individually
// (never collapsed before reaching this contract) so a caller can see WHY
// ownership was or wasn't acceptable, per TRD CAND-003.

export const ownershipContractVersion = 'theta-ownership-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const componentScoreSchema = z.object({
  name: z.enum(['LiquidityQuality', 'StructuralQuality', 'RecoveryQuality', 'TailQuality', 'EventAdjustment']),
  value: z.number().min(0).max(1).nullable(),
  status: z.enum(['ARCHITECTURAL', 'TEST']),
  reasons: z.array(reasonSchema),
});

export const ownershipEvaluationResponseSchema = z.object({
  contractVersion: z.literal(ownershipContractVersion),
  snapshotId: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  ownability: z.number().min(0).max(1).nullable(),
  components: z.array(componentScoreSchema).length(5),
  thesisInvalidated: z.boolean(),
  reasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  const anyComponentUnknown = response.components.some((component) => component.value === null);
  if (anyComponentUnknown && response.ownability !== null) {
    context.addIssue({ code: 'custom', message: 'ownability must be UNKNOWN (null) when any component is UNKNOWN' });
  }
  if (!anyComponentUnknown && response.ownability === null) {
    context.addIssue({ code: 'custom', message: 'ownability must be computable when every component is known' });
  }
});

export type OwnershipEvaluationResponse = z.infer<typeof ownershipEvaluationResponseSchema>;

export function parseOwnershipEvaluationResponse(payload: unknown): OwnershipEvaluationResponse {
  return ownershipEvaluationResponseSchema.parse(payload);
}
