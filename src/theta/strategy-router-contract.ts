import { z } from 'zod';

// Versioned request/response contract for bots/theta/quant/models/strategy_router.py.
// Every strategy family gets a result (eligible or not) -- this is a
// ROUTING decision, never a consensus vote: one family's ineligibility
// must never be interpreted as a "no" that pushes the account toward WAIT.

export const strategyRouterContractVersion = 'theta-strategy-router-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const strategyFamily = z.enum(['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D']);
export type StrategyFamily = z.infer<typeof strategyFamily>;

export const eligibilityState = z.enum([
  'ELIGIBLE_PRIMARY',
  'ELIGIBLE_CHALLENGER',
  'ELIGIBLE_REDUCED',
  'INELIGIBLE_STATE',
  'INELIGIBLE_RISK',
  'INELIGIBLE_DATA',
  'INELIGIBLE_STRUCTURE',
  'PASS',
]);

const ELIGIBLE_STATES = new Set(['ELIGIBLE_PRIMARY', 'ELIGIBLE_CHALLENGER', 'ELIGIBLE_REDUCED']);

const strategyEligibilityResultSchema = z.object({
  strategyFamily,
  eligible: z.boolean(),
  eligibilityState,
  reasons: z.array(reasonSchema),
  policyVersion: z.string().min(1),
}).superRefine((result, context) => {
  if (result.eligible !== ELIGIBLE_STATES.has(result.eligibilityState)) {
    context.addIssue({ code: 'custom', message: 'eligible must agree with eligibilityState' });
  }
});

export const strategyRoutingResponseSchema = z.object({
  contractVersion: z.literal(strategyRouterContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  results: z.array(strategyEligibilityResultSchema).length(6),
}).superRefine((response, context) => {
  const families = response.results.map((r) => r.strategyFamily);
  if (new Set(families).size !== 6) {
    context.addIssue({ code: 'custom', message: 'every strategy family must appear exactly once -- routing is never a partial vote' });
  }
});

export type StrategyRoutingResponse = z.infer<typeof strategyRoutingResponseSchema>;

export function parseStrategyRoutingResponse(payload: unknown): StrategyRoutingResponse {
  return strategyRoutingResponseSchema.parse(payload);
}

export function eligibleFamilies(response: StrategyRoutingResponse): readonly StrategyFamily[] {
  return response.results.filter((r) => r.eligible).map((r) => r.strategyFamily);
}
