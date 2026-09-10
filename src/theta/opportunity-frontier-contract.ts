import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/opportunity_frontier.py (batch adapter). WAIT and
// PASS stay structurally distinct here exactly as the Python model keeps
// them: WAIT always carries a specific, monitorable waitReason; PASS never
// does. A single bad candidate must never suppress another's independent
// OPEN_* disposition -- see globalIdle, which only appears when NO
// candidate qualifies, and always proves the book was actually searched.

export const opportunityFrontierContractVersion = 'theta-opportunity-frontier-runtime-v1' as const;

const reasonSchema = z.object({
  code: z.string().min(1),
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  detail: z.string().min(1),
});

export const candidateDisposition = z.enum([
  'OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY',
  'OPEN_ALTERNATE_STRUCTURE', 'WAIT', 'PASS',
]);
export type CandidateDisposition = z.infer<typeof candidateDisposition>;

const OPEN_DISPOSITIONS = new Set<CandidateDisposition>([
  'OPEN_FULL', 'OPEN_REDUCED', 'OPEN_ALTERNATE_CONTRACT', 'OPEN_ALTERNATE_EXPIRY', 'OPEN_ALTERNATE_STRUCTURE',
]);

export const waitReason = z.enum(['WAIT_PRICE', 'WAIT_VOL', 'WAIT_LIQUIDITY', 'WAIT_EVENT', 'WAIT_REGIME']);

const opportunityEntrySchema = z.object({
  candidateId: z.string().min(1),
  rank: z.number().int().positive().nullable(),
  disposition: candidateDisposition,
  waitReason: waitReason.nullable(),
  rejectionCategory: z.string().min(1).nullable(),
  reasons: z.array(reasonSchema),
}).superRefine((entry, context) => {
  if (entry.disposition === 'WAIT' && entry.waitReason === null) {
    context.addIssue({ code: 'custom', message: 'WAIT must carry a specific waitReason' });
  }
  if (entry.disposition !== 'WAIT' && entry.waitReason !== null) {
    context.addIssue({ code: 'custom', message: 'waitReason is only meaningful for WAIT' });
  }
  if (OPEN_DISPOSITIONS.has(entry.disposition) && entry.rank === null) {
    context.addIssue({ code: 'custom', message: 'an OPEN_* disposition must carry a rank' });
  }
  if (!OPEN_DISPOSITIONS.has(entry.disposition) && entry.rank !== null) {
    context.addIssue({ code: 'custom', message: 'only OPEN_* dispositions are ranked' });
  }
});

const globalIdleReasonSchema = z.enum([
  'NO_POSITIVE_AFTER_COST_EDGE', 'PORTFOLIO_RISK_CAP_REACHED', 'CAPITAL_UNAVAILABLE', 'MARKET_DATA_INVALID',
  'BROKER_UNAVAILABLE', 'SYSTEM_QUARANTINED', 'ALL_ELIGIBLE_CONTRACTS_ILLIQUID', 'EVENT_RISK_CLUSTER', 'REGIME_RISK',
]);

const globalIdleReportSchema = z.object({
  reason: globalIdleReasonSchema,
  eligibleUnderlyingsScanned: z.number().int().nonnegative(),
  contractsEvaluated: z.number().int().nonnegative(),
  positiveEvCandidates: z.number().int().nonnegative(),
  riskRejectedCandidates: z.number().int().nonnegative(),
  executionRejectedCandidates: z.number().int().nonnegative(),
  bestRejectedCandidateId: z.string().min(1).nullable(),
  bestRejectedEv: z.number().finite().nullable(),
});

export const opportunityFrontierResponseSchema = z.object({
  contractVersion: z.literal(opportunityFrontierContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  entries: z.array(opportunityEntrySchema),
  actionableCandidateIds: z.array(z.string().min(1)),
  globalIdle: globalIdleReportSchema.nullable(),
}).superRefine((response, context) => {
  const ids = response.entries.map((e) => e.candidateId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'candidateId values must be unique' });
  }
  if (response.actionableCandidateIds.length > 0 && response.globalIdle !== null) {
    context.addIssue({ code: 'custom', message: 'globalIdle must be null whenever at least one actionable candidate exists' });
  }
  if (response.actionableCandidateIds.length === 0 && response.entries.length > 0 && response.globalIdle === null) {
    context.addIssue({ code: 'custom', message: 'no actionable candidate requires a globalIdle report proving the book was searched' });
  }
});

export type OpportunityFrontierResponse = z.infer<typeof opportunityFrontierResponseSchema>;

export function parseOpportunityFrontierResponse(payload: unknown): OpportunityFrontierResponse {
  return opportunityFrontierResponseSchema.parse(payload);
}
