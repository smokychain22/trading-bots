import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/covered_call_ranker.py (R1H item K2/K3): the
// OPENING decision among WAIT / SELL_STOCK / SELL_CC(candidates) for
// stock currently held. TypeScript never recomputes CCUtility itself --
// Python quant is mathematical policy truth.

export const coveredCallContractVersion = 'theta-covered-call-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const valuationSchema = z.object({
  label: z.string().min(1),
  utility: z.number().finite().nullable(),
  reasons: z.array(reasonSchema),
});

export const coveredCallDecisionResponseSchema = z.object({
  contractVersion: z.literal(coveredCallContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  fusionSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  selectedLabel: z.string().min(1),
  selectedReasons: z.array(reasonSchema),
  valuations: z.array(valuationSchema).min(1),
}).superRefine((response, context) => {
  const selected = response.valuations.find((valuation) => valuation.label === response.selectedLabel);
  if (!selected) {
    context.addIssue({ code: 'custom', message: 'selectedLabel must correspond to one of the persisted valuations' });
    return;
  }
  if (selected.utility === null && response.selectedLabel !== 'WAIT') {
    context.addIssue({ code: 'custom', message: 'only WAIT may be selected with an unknown utility' });
  }
});

export type CoveredCallDecisionResponse = z.infer<typeof coveredCallDecisionResponseSchema>;

export function parseCoveredCallDecisionResponse(
  payload: unknown,
  expectedFusionSnapshotHash: string,
): CoveredCallDecisionResponse {
  const response = coveredCallDecisionResponseSchema.parse(payload);
  if (response.fusionSnapshotHash !== expectedFusionSnapshotHash) {
    throw new Error('Covered-call decision response belongs to a different FusionSnapshot');
  }
  return response;
}
