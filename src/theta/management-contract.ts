import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/management_action_value.py. TypeScript never
// recomputes ManagementUtility/RollUtility itself -- Python quant is
// mathematical policy truth (docs/quant/phase2/PHASE2_MASTER_SPEC.md).
// This file only validates and types what Python returns.

export const managementContractVersion = 'theta-management-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

const managementActionSchema = z.enum([
  'HOLD',
  'CLOSE',
  'ROLL',
  'ASSIGN',
  'EXPIRE',
  'SELL_CC',
  'CLOSE_STOCK',
  'CALL_AWAY',
  'REDEPLOY',
]);

const actionValuationSchema = z.object({
  action: managementActionSchema,
  feasible: z.boolean(),
  certainCashflow: z.number().finite().nullable(),
  estimatedFutureValue: z.number().finite().nullable(),
  tailRiskPenalty: z.number().finite().nullable(),
  capitalDaysPenalty: z.number().finite().nullable(),
  executionPenalty: z.number().finite().nullable(),
  utility: z.number().finite().nullable(),
  reasons: z.array(reasonSchema),
}).superRefine((valuation, context) => {
  if (!valuation.feasible && valuation.utility !== null) {
    context.addIssue({ code: 'custom', message: 'an infeasible action must never carry a known utility' });
  }
});

export const managementDecisionResponseSchema = z.object({
  contractVersion: z.literal(managementContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  fusionSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  valuations: z.array(actionValuationSchema).min(1),
  selectedAction: managementActionSchema,
  selectedReasons: z.array(reasonSchema),
}).superRefine((response, context) => {
  const selected = response.valuations.find((valuation) => valuation.action === response.selectedAction);
  if (!selected) {
    context.addIssue({ code: 'custom', message: 'selectedAction must correspond to one of the persisted valuations' });
    return;
  }
  if (!selected.feasible) {
    context.addIssue({ code: 'custom', message: 'selectedAction must be feasible' });
  }
  // HOLD is the only action this contract permits selecting with an unknown
  // utility -- the "never force a trade" default (management_action_value.py).
  if (selected.utility === null && response.selectedAction !== 'HOLD') {
    context.addIssue({ code: 'custom', message: 'only HOLD may be selected with an unknown utility' });
  }
});

export type ManagementDecisionResponse = z.infer<typeof managementDecisionResponseSchema>;

export function parseManagementDecisionResponse(
  payload: unknown,
  expectedFusionSnapshotHash: string,
): ManagementDecisionResponse {
  const response = managementDecisionResponseSchema.parse(payload);
  if (response.fusionSnapshotHash !== expectedFusionSnapshotHash) {
    throw new Error('Management decision response belongs to a different FusionSnapshot');
  }
  return response;
}
