import { z } from 'zod';

// Versioned request/response contract for
// bots/theta/quant/models/pareto_frontier.py (batch adapter -- one call
// covers every candidate in a snapshot, since dominance is inherently a
// pairwise whole-set comparison).

export const paretoFrontierContractVersion = 'theta-pareto-frontier-runtime-v1' as const;

const nullableFiniteNumber = z.number().finite().nullable();

export const candidateEconomicsSchema = z.object({
  candidateId: z.string().min(1),
  grossCredit: nullableFiniteNumber, // reporting only -- NOT a dominance dimension
  evNet: nullableFiniteNumber,
  calibratedPWin: z.number().min(0).max(1).nullable(),
  breakEvenWr: z.number().min(0).max(1).nullable(),
  edgeBuffer: nullableFiniteNumber,
  expectedTailLoss: nullableFiniteNumber,
  assignmentProbability: z.number().min(0).max(1).nullable(),
  severeDrawdownProbability: z.number().min(0).max(1).nullable(),
  capitalRequirement: z.number().finite().nonnegative().nullable(),
  capitalDays: z.number().finite().nonnegative().nullable(),
  returnPerCapitalDay: nullableFiniteNumber,
  liquiditySpreadPct: z.number().finite().nonnegative().nullable(),
  fillProbability: z.number().min(0).max(1).nullable(),
  expectedSlippage: z.number().finite().nonnegative().nullable(),
  modelUncertainty: z.number().min(0).max(1).nullable(),
});

export type CandidateEconomics = z.infer<typeof candidateEconomicsSchema>;

const paretoResultSchema = z.object({
  candidateId: z.string().min(1),
  survivesFrontier: z.boolean(),
  dominatedBy: z.array(z.string().min(1)),
}).superRefine((result, context) => {
  if (result.survivesFrontier && result.dominatedBy.length > 0) {
    context.addIssue({ code: 'custom', message: 'a surviving candidate cannot also be dominated' });
  }
  if (!result.survivesFrontier && result.dominatedBy.length === 0) {
    context.addIssue({ code: 'custom', message: 'an eliminated candidate must name at least one dominator' });
  }
});

export const paretoFrontierResponseSchema = z.object({
  contractVersion: z.literal(paretoFrontierContractVersion),
  snapshotId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  results: z.array(paretoResultSchema),
}).superRefine((response, context) => {
  const ids = response.results.map((r) => r.candidateId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'candidateId values must be unique' });
  }
});

export type ParetoFrontierResponse = z.infer<typeof paretoFrontierResponseSchema>;

export function parseParetoFrontierResponse(payload: unknown): ParetoFrontierResponse {
  return paretoFrontierResponseSchema.parse(payload);
}

export function survivingCandidateIds(response: ParetoFrontierResponse): readonly string[] {
  return response.results.filter((r) => r.survivesFrontier).map((r) => r.candidateId);
}
