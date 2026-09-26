/**
 * COMMAND 5B item 23: experience memory. Research-only, `brokerAuthority:
 * false`. A "have we seen market states similar to this one before?"
 * contract -- explicitly NOT a single composite score (the directive
 * forbids inventing "one magical IQ score"; see also
 * `theta-iq-readiness-dimensions.ts` for the same discipline applied to
 * readiness reporting). Nearest-neighbor anecdotes from this contract may
 * never control Production; every field here is descriptive-only.
 */

export const experienceMemoryContractVersion = 'theta-experience-memory-contract-v1' as const;

export interface StrategyOutcomeSummary {
  readonly strategy: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
  readonly episodeCount: number;
  readonly independentEpisodeCount: number;
  /** null until real resolved outcomes exist for this cohort. */
  readonly meanAfterCostOutcome: number | null;
}

export interface SimilarSituationReport {
  readonly contractVersion: typeof experienceMemoryContractVersion;
  readonly queryDecisionId: string;
  readonly similarityDefinitionVersion: string;
  readonly similarEpisodeCount: number;
  readonly independentEpisodeCount: number;
  readonly perStrategy: readonly StrategyOutcomeSummary[];
  readonly waitOutcomeCount: number;
  readonly assignmentFrequency: number | null;
  readonly tailEventFrequency: number | null;
  readonly flowStateSimilarity: number | null;
  readonly regimeSimilarity: number | null;
}

/**
 * The honest zero-evidence report for a query with no matched historical
 * episodes yet -- every count is a real 0 (a real, meaningful "we found
 * nothing", not a placeholder), every rate/frequency field is `null`
 * (genuinely not computable from zero episodes, distinct from a
 * measured-zero rate).
 */
export function buildEmptySimilarSituationReport(input: { readonly queryDecisionId: string; readonly similarityDefinitionVersion: string }): SimilarSituationReport {
  return {
    contractVersion: experienceMemoryContractVersion,
    queryDecisionId: input.queryDecisionId, similarityDefinitionVersion: input.similarityDefinitionVersion,
    similarEpisodeCount: 0, independentEpisodeCount: 0,
    perStrategy: (['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'] as const).map((strategy) => ({
      strategy, episodeCount: 0, independentEpisodeCount: 0, meanAfterCostOutcome: null,
    })),
    waitOutcomeCount: 0, assignmentFrequency: null, tailEventFrequency: null, flowStateSimilarity: null, regimeSimilarity: null,
  };
}

/** This module deliberately exports no function that combines the above
 * fields into a single scalar -- callers must consume the dimensions
 * separately, matching the directive's explicit prohibition. */
export const EXPERIENCE_MEMORY_HAS_NO_COMPOSITE_SCORE = true as const;
