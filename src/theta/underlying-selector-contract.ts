import { z } from 'zod';

const nullableUnitScore = z.number().finite().min(0).max(1).nullable();
const scoreEvidence = z.object({
  provider: z.enum(['ALPACA', 'OPTIONOMICS', 'DERIVED']),
  operationAlias: z.string().min(1),
  asOf: z.string().datetime({ offset: true }).nullable(),
  retrievedAt: z.string().datetime({ offset: true }),
  state: z.enum(['GOOD', 'DEGRADED', 'STALE', 'UNKNOWN', 'INVALID', 'NOT_ENTITLED']),
  modelVersion: z.string().min(1),
});
const scoreKeys = ['liquidity', 'ownershipSuitability', 'drawdownRecovery', 'trendMomentum',
  'realizedVolatilitySuitability', 'eventSafety', 'sectorDiversification',
  'correlationDiversification', 'portfolioCapacity', 'fundamentalQuality'] as const;

export const underlyingSelectorCandidateSchema = z.object({
  symbol: z.string().min(1),
  featureSnapshotId: z.string().min(1),
  featureSetVersion: z.string().min(1),
  mechanicallyEligible: z.boolean(),
  hardBlockers: z.array(z.string()),
  scores: z.object({
    liquidity: nullableUnitScore,
    ownershipSuitability: nullableUnitScore,
    drawdownRecovery: nullableUnitScore,
    trendMomentum: nullableUnitScore,
    realizedVolatilitySuitability: nullableUnitScore,
    eventSafety: nullableUnitScore,
    sectorDiversification: nullableUnitScore,
    correlationDiversification: nullableUnitScore,
    portfolioCapacity: nullableUnitScore,
    fundamentalQuality: nullableUnitScore,
  }),
  scoreProvenance: z.object({
    liquidity: scoreEvidence, ownershipSuitability: scoreEvidence, drawdownRecovery: scoreEvidence,
    trendMomentum: scoreEvidence, realizedVolatilitySuitability: scoreEvidence, eventSafety: scoreEvidence,
    sectorDiversification: scoreEvidence, correlationDiversification: scoreEvidence,
    portfolioCapacity: scoreEvidence, fundamentalQuality: scoreEvidence,
  }),
}).superRefine((candidate, context) => {
  if (candidate.mechanicallyEligible !== (candidate.hardBlockers.length === 0)) {
    context.addIssue({ code: 'custom', message: 'mechanical eligibility must agree with hard blockers' });
  }
  for (const key of scoreKeys) {
    const known = candidate.scores[key] !== null;
    const state = candidate.scoreProvenance[key].state;
    if (known && ['UNKNOWN', 'INVALID', 'NOT_ENTITLED'].includes(state)) {
      context.addIssue({ code: 'custom', path: ['scoreProvenance', key], message: 'known score has unusable evidence state' });
    }
    if (!known && state === 'GOOD') {
      context.addIssue({ code: 'custom', path: ['scoreProvenance', key], message: 'GOOD evidence cannot carry an UNKNOWN score' });
    }
  }
});

export type UnderlyingSelectorCandidate = z.infer<typeof underlyingSelectorCandidateSchema>;

export interface UnderlyingSelectorResult {
  readonly ranked: readonly UnderlyingSelectorCandidate[];
  readonly paretoFrontierSymbols: readonly string[];
  readonly unrankableSymbols: readonly string[];
  readonly unknownScoreFamiliesBySymbol: Readonly<Record<string, readonly string[]>>;
}

/**
 * Produces a deterministic Pareto ranking without inventing feature weights.
 * A candidate cannot dominate another unless both values are known on every
 * compared dimension. UNKNOWN scores stay visible and never become zero.
 */
export function rankUnderlyingCandidates(input: readonly UnderlyingSelectorCandidate[]): UnderlyingSelectorResult {
  const parsed = input.map((candidate) => underlyingSelectorCandidateSchema.parse(candidate));
  const eligible = parsed.filter((candidate) => candidate.mechanicallyEligible);
  const unknownScoreFamiliesBySymbol: Record<string, readonly string[]> = {};
  for (const candidate of parsed) {
    unknownScoreFamiliesBySymbol[candidate.symbol] = Object.entries(candidate.scores)
      .filter(([, value]) => value === null).map(([name]) => name);
  }
  const rankable = eligible.filter((candidate) => scoreKeys.every((key) => candidate.scores[key] !== null
    && candidate.scoreProvenance[key].state === 'GOOD'));
  const unrankableSymbols = eligible.filter((candidate) => scoreKeys.some((key) => candidate.scores[key] === null
    || candidate.scoreProvenance[key].state !== 'GOOD'))
    .map((candidate) => candidate.symbol).sort();
  const scoreValues = (candidate: UnderlyingSelectorCandidate): readonly (number | null)[] => Object.values(candidate.scores);
  const dominates = (left: UnderlyingSelectorCandidate, right: UnderlyingSelectorCandidate): boolean => {
    const pairs = scoreValues(left).map((value, index) => [value, scoreValues(right)[index]] as const);
    if (pairs.some(([a, b]) => a === null || b === null)) return false;
    return pairs.every(([a, b]) => (a as number) >= (b as number)) && pairs.some(([a, b]) => (a as number) > (b as number));
  };
  const dominationCounts = new Map(rankable.map((candidate) => [candidate.symbol,
    rankable.filter((other) => other.symbol !== candidate.symbol && dominates(other, candidate)).length]));
  const ranked = [...rankable].sort((a, b) => (dominationCounts.get(a.symbol) ?? 0) - (dominationCounts.get(b.symbol) ?? 0)
    || a.symbol.localeCompare(b.symbol));
  return {
    ranked,
    paretoFrontierSymbols: ranked.filter((candidate) => dominationCounts.get(candidate.symbol) === 0).map((candidate) => candidate.symbol),
    unrankableSymbols,
    unknownScoreFamiliesBySymbol,
  };
}
