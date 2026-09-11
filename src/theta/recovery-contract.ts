import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/recovery_decision.py (R1H item K2). TypeScript
// never recomputes the RECOVERY_WAIT/SELL_STOCK/SELL_CC decision itself
// -- Python quant is mathematical policy truth.
//
// partialSellStock is always {modeled: false} -- recovery_decision.py has
// no partial-sell economics yet, and this contract never fabricates one
// (see recovery_contract.py's own docstring).

export const recoveryContractVersion = 'theta-recovery-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const recoveryActionSchema = z.enum(['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC']);

export const recoveryDecisionResponseSchema = z.object({
  contractVersion: z.literal(recoveryContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  fusionSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  action: recoveryActionSchema,
  boundExceeded: z.boolean(),
  reasons: z.array(reasonSchema),
  partialSellStock: z.object({ modeled: z.literal(false) }),
});

export type RecoveryDecisionResponse = z.infer<typeof recoveryDecisionResponseSchema>;

export function parseRecoveryDecisionResponse(
  payload: unknown,
  expectedFusionSnapshotHash: string,
): RecoveryDecisionResponse {
  const response = recoveryDecisionResponseSchema.parse(payload);
  if (response.fusionSnapshotHash !== expectedFusionSnapshotHash) {
    throw new Error('Recovery decision response belongs to a different FusionSnapshot');
  }
  return response;
}
