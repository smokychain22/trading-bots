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

export const riskFamilySchema = z.enum([
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
  // Optional for older immutable receipts. Current Python emits this exact
  // consumed-input trace. It doesn't invent upstream source observation time.
  inputEvidence: z.object({
    version: z.literal('theta-aegis-family-input-evidence-v1'),
    decisionId: z.string().min(1), snapshotId: z.string().min(1), decisionAsOf: z.string().datetime({ offset: true }),
    policyVersion: z.string().min(1),
    inputs: z.record(z.string(), z.union([z.number().finite(), z.string(), z.boolean(), z.null()])),
    unit: z.enum(['DECIMAL_EQUITY_FRACTION', 'TYPED_STATE']), source: z.literal('BOUND_REQUEST_SNAPSHOT'),
    sourceObservedAt: z.null(), sourceFreshness: z.literal('NOT_PROVEN_BY_RISK_ENGINE'),
    rule: z.string().min(1), softThreshold: z.number().finite().nonnegative().nullable(),
    hardThreshold: z.number().finite().nonnegative().nullable(), providerRequiredStates: z.array(z.string()).nullable(),
    compoundStressHoldCount: z.number().int().min(2).nullable(), quantityCapacity: z.null(),
    capacityState: z.literal('DERIVED_SEPARATELY_BY_CANONICAL_SIZING'),
  }).optional(),
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
  compoundStressHoldCount: z.number().int().min(2),
  policyConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  families: z.array(familyAssessmentSchema).length(riskFamilySchema.options.length),
  newRiskState: riskStateSchema,
  reasons: z.array(reasonSchema),
  permittedActions: z.array(z.string().min(1)),
}).superRefine((response, context) => {
  const names = response.families.map(family => family.family);
  for (const family of response.families) {
    const evidence = family.inputEvidence;
    if (evidence && (evidence.decisionId !== response.decisionId || evidence.snapshotId !== response.snapshotId
      || evidence.decisionAsOf !== response.timestamp || evidence.policyVersion !== response.policyVersion)) {
      context.addIssue({ code: 'custom', message: 'AEGIS family input evidence identity mismatch' });
    }
  }
  if (new Set(names).size !== riskFamilySchema.options.length
    || riskFamilySchema.options.some(name => !names.includes(name))) {
    context.addIssue({ code: 'custom', message: 'AEGIS must assess each of the twelve risk families exactly once' });
  }
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

export function parseAegisAssessmentResponse(payload: unknown, expected?: {
  decisionId: string; snapshotId: string; timestamp: string; policyVersion?: string;
}): AegisAssessmentResponse {
  const response = aegisAssessmentResponseSchema.parse(payload);
  if (expected && (response.decisionId !== expected.decisionId || response.snapshotId !== expected.snapshotId
    || response.timestamp !== expected.timestamp || (expected.policyVersion !== undefined && response.policyVersion !== expected.policyVersion)))
    throw new Error('AEGIS_RESPONSE_IDENTITY_MISMATCH');
  return response;
}

export function isActionPermitted(response: AegisAssessmentResponse, action: string): boolean {
  return response.permittedActions.includes(action);
}
