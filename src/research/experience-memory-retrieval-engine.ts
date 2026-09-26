/**
 * COMMAND 5C-7 items 43-44: experience-memory actual retrieval. Real
 * versioned-similarity-policy retrieval producing a
 * `SimilarSituationReport` (`experience-memory-contract.ts`), with the
 * anti-leakage rule enforced structurally: for a decision at T, only
 * episodes whose required labels were available strictly before T are
 * eligible historical experience.
 */
import { type SimilarSituationReport, buildEmptySimilarSituationReport } from './experience-memory-contract.js';

export const experienceMemoryRetrievalEngineVersion = 'theta-experience-memory-retrieval-engine-v1' as const;

export interface HistoricalEpisodeRecord {
  readonly episodeId: string;
  readonly chainId: string;
  readonly strategy: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
  readonly labelAvailableAt: string | null;
  readonly regime: string | null;
  readonly flowCohort: string | null;
  readonly afterCostOutcome: number | null;
  readonly wasAssignment: boolean;
  readonly wasTailEvent: boolean;
  readonly isWaitOutcome: boolean;
  /** A real, versioned feature vector (regime/flow/vol bucket etc.) used
   * for the similarity distance -- caller-computed, not this module's
   * concern to derive features from raw market data. */
  readonly similarityFeatures: Readonly<Record<string, number>>;
}

export interface SimilarityQuery {
  readonly queryDecisionId: string;
  readonly decisionAt: string;
  readonly similarityDefinitionVersion: string;
  readonly queryFeatures: Readonly<Record<string, number>>;
  readonly regime: string | null;
  readonly flowCohort: string | null;
  /** Real, capped neighborhood size -- a distance threshold or top-K, the
   * caller's explicit choice, never an unbounded "all history" scan. */
  readonly maxDistance: number;
}

function euclideanDistance(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sumSquares = 0;
  for (const key of keys) sumSquares += ((a[key] ?? 0) - (b[key] ?? 0)) ** 2;
  return Math.sqrt(sumSquares);
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * CORE ANTI-LEAKAGE RULE: an episode is eligible historical experience
 * for a query at time T only if its `labelAvailableAt` is a real, known
 * timestamp strictly before T. An episode with `labelAvailableAt: null`
 * (label never resolved / not yet available) is excluded entirely, never
 * treated as "available now" by default.
 */
export function isEligibleHistoricalExperience(episode: HistoricalEpisodeRecord, queryDecisionAt: string): boolean {
  if (episode.labelAvailableAt === null) return false;
  return Date.parse(episode.labelAvailableAt) < Date.parse(queryDecisionAt);
}

/**
 * Real retrieval: filters to anti-leakage-eligible episodes, computes a
 * real Euclidean similarity distance in the caller-supplied feature
 * space, keeps neighbors within `maxDistance`, and reports every
 * dimension the contract requires -- separately, never combined into one
 * score (`experience-memory-contract.ts`'s own structural discipline).
 */
export function retrieveSimilarSituations(
  query: SimilarityQuery, corpus: readonly HistoricalEpisodeRecord[],
): SimilarSituationReport {
  const eligible = corpus.filter((e) => isEligibleHistoricalExperience(e, query.decisionAt));
  const neighbors = eligible.filter((e) => euclideanDistance(e.similarityFeatures, query.queryFeatures) <= query.maxDistance);

  if (neighbors.length === 0) {
    return buildEmptySimilarSituationReport({ queryDecisionId: query.queryDecisionId, similarityDefinitionVersion: query.similarityDefinitionVersion });
  }

  const independentWholeChainIds = new Set(neighbors.map((n) => n.chainId));
  const strategies: readonly ('THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK')[] = ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'];
  const perStrategy = strategies.map((strategy) => {
    const members = neighbors.filter((n) => n.strategy === strategy);
    return {
      strategy, episodeCount: members.length,
      independentEpisodeCount: new Set(members.map((m) => m.chainId)).size,
      meanAfterCostOutcome: average(members.map((m) => m.afterCostOutcome).filter((v): v is number => v !== null)),
    };
  });

  const assignmentEligible = neighbors;
  const tailEligible = neighbors;
  const regimeMatches = neighbors.filter((n) => n.regime !== null && n.regime === query.regime).length;
  const flowMatches = neighbors.filter((n) => n.flowCohort !== null && n.flowCohort === query.flowCohort).length;

  return {
    contractVersion: 'theta-experience-memory-contract-v1',
    queryDecisionId: query.queryDecisionId, similarityDefinitionVersion: query.similarityDefinitionVersion,
    similarEpisodeCount: neighbors.length, independentEpisodeCount: independentWholeChainIds.size,
    perStrategy,
    waitOutcomeCount: neighbors.filter((n) => n.isWaitOutcome).length,
    assignmentFrequency: assignmentEligible.length === 0 ? null : neighbors.filter((n) => n.wasAssignment).length / assignmentEligible.length,
    tailEventFrequency: tailEligible.length === 0 ? null : neighbors.filter((n) => n.wasTailEvent).length / tailEligible.length,
    flowStateSimilarity: neighbors.length === 0 ? null : flowMatches / neighbors.length,
    regimeSimilarity: neighbors.length === 0 ? null : regimeMatches / neighbors.length,
  };
}
