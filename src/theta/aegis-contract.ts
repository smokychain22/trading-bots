import { z } from 'zod';

// Versioned request/response contract for bots/theta/quant/models/aegis.py.
// The risk state AND the permitted-action set are both computed by Python
// and carried as data here -- TypeScript never reimplements the
// strictest-family-wins aggregation or the exit-supremacy action-permission
// matrix, to avoid the two languages' policy logic drifting apart
// (docs/quant/phase2/PHASE2_MASTER_SPEC.md's "TS orchestrates, Python is
// quantitative/policy truth").

export const aegisContractVersion = 'theta-aegis-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const riskStateSchema = z.enum([
  'ALLOW_FULL',
  'ALLOW_REDUCED',
  'DEFINED_RISK_ONLY',
  'HOLD_ONLY',
  'HARD_VETO',
]);

const riskFamilySchema = z.enum([
  'PER_TRADE',
  'UNDERLYING',
  'SECTOR',
  'CORRELATION',
  'PORTFOLIO',
  'INVENTORY',
  'ASSIGNMENT',
  'RECOVERY',
  'LIQUIDITY',
  'EXECUTION',
  'PROVIDER',
  'SYSTEM',
]);

const familyAssessmentSchema = z.object({
  family: riskFamilySchema,
  state: riskStateSchema,
  reasons: z.array(reasonSchema),
});

// Risk-reducing actions this contract requires to always be permitted,
// regardless of newRiskState -- exit supremacy is validated here as a
// contract invariant, not left to trust in whatever Python happened to send.
const EXIT_SUPREMACY_ACTIONS = ['CLOSE', 'CANCEL', 'BUY_TO_CLOSE', 'RECONCILE', 'REDUCE_POSITION', 'SAFETY_EXIT'] as const;

export const aegisAssessmentResponseSchema = z.object({
  contractVersion: z.literal(aegisContractVersion),
  decisionId: z.string().min(1),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  families: z.array(familyAssessmentSchema).min(1),
  newRiskState: riskStateSchema,
  reasons: z.array(reasonSchema),
  permittedActions: z.array(z.string().min(1)),
}).superRefine((response, context) => {
  const strictness: Record<z.infer<typeof riskStateSchema>, number> = {
    ALLOW_FULL: 0,
    ALLOW_REDUCED: 1,
    DEFINED_RISK_ONLY: 2,
    HOLD_ONLY: 3,
    HARD_VETO: 4,
  };
  const worstFamily = response.families.reduce(
    (worst, family) => (strictness[family.state] > strictness[worst] ? family.state : worst),
    'ALLOW_FULL' as z.infer<typeof riskStateSchema>,
  );
  if (strictness[response.newRiskState] !== strictness[worstFamily]) {
    context.addIssue({ code: 'custom', message: 'newRiskState must equal the strictest family state' });
  }
  for (const action of EXIT_SUPREMACY_ACTIONS) {
    if (!response.permittedActions.includes(action)) {
      context.addIssue({ code: 'custom', message: `exit supremacy violated: ${action} must always be permitted` });
    }
  }
});

export type AegisAssessmentResponse = z.infer<typeof aegisAssessmentResponseSchema>;

export function parseAegisAssessmentResponse(payload: unknown): AegisAssessmentResponse {
  return aegisAssessmentResponseSchema.parse(payload);
}

export function isActionPermitted(response: AegisAssessmentResponse, action: string): boolean {
  return response.permittedActions.includes(action);
}
