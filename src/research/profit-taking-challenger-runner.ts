/**
 * COMMAND 5C-7 item 35: profit-taking challenger runner. Evaluates all 17
 * canonical V7 challengers against the SAME set of resolved episodes,
 * with the same cost model / dependence grouping / outcome definitions --
 * avoids the cross-policy denominator drift the directive warns against
 * by restricting every policy's aggregate to the intersection of episodes
 * where EVERY policy has a resolved comparison row.
 */
import {
  buildProfitTakingComparisonRow, type ProfitTakingComparisonRow, type V7ProfitTakingPolicy, canonicalV7ProfitTakingPolicies,
} from './profit-taking-experiment.js';

export const profitTakingChallengerRunnerVersion = 'theta-profit-taking-challenger-runner-v2' as const;
const metricKeys = ['incrementalWholeChainNetPnl', 'incrementalCapitalDays', 'incrementalDownside', 'incrementalExecutionCost'] as const;
type Metric = typeof metricKeys[number];

export interface ChallengerPolicyMetrics {
  readonly policy: V7ProfitTakingPolicy;
  readonly episodeCount: number;
  readonly averageIncrementalWholeChainNetPnl: number | null;
  readonly averageIncrementalCapitalDays: number | null;
  readonly averageIncrementalDownside: number | null;
  readonly averageIncrementalExecutionCost: number | null;
}

export interface ProfitTakingChallengerRunResult {
  readonly contractVersion: typeof profitTakingChallengerRunnerVersion;
  readonly commonEpisodeCount: number;
  readonly excludedEpisodeIds: readonly string[];
  readonly perPolicy: readonly ChallengerPolicyMetrics[];
  /** DSR/PBO trial count for this comparison -- one trial per challenger
   * policy actually evaluated, matching `selection-bias-receipt.ts`'s
   * requirement that every variant searched (not just the winner) is
   * counted. */
  readonly numberOfTrials: number;
  readonly trialIdentities: readonly string[];
  readonly metricCohorts: Readonly<Record<Metric, readonly string[]>>;
  readonly truthClass: ProfitTakingComparisonRow['counterfactualOutcomeState'] | null;
}

function average(values: readonly number[]): number | null {
  const result = values.reduce((a, b) => a + b / values.length, 0);
  return values.length === 0 || !Number.isFinite(result) ? null : result;
}

/**
 * `rows` must contain, for every (episodeId, policy) pair the caller
 * wants evaluated, one `ProfitTakingComparisonRow`. `episodeId` is
 * derived from `state.episodeId` on each row. Only episodes present for
 * EVERY canonical policy contribute to any policy's aggregate -- this is
 * the real denominator-drift guard: a policy is never compared over a
 * larger or smaller episode set than its peers.
 */
export function runProfitTakingChallengerComparison(
  rows: readonly ProfitTakingComparisonRow[],
): ProfitTakingChallengerRunResult {
  const rowsByPolicy = new Map<V7ProfitTakingPolicy, Map<string, ProfitTakingComparisonRow>>();
  for (const policy of canonicalV7ProfitTakingPolicies) rowsByPolicy.set(policy, new Map());
  for (const row of rows) {
    const policy = row.challengerPolicy;
    if (!canonicalV7ProfitTakingPolicies.includes(policy as V7ProfitTakingPolicy)) continue; // legacy policies excluded from this canonical runner
    buildProfitTakingComparisonRow(row);
    if (rowsByPolicy.get(policy as V7ProfitTakingPolicy)?.has(row.state.episodeId)) throw new Error('PROFIT_TAKING_DUPLICATE_EPISODE_POLICY');
    rowsByPolicy.get(policy as V7ProfitTakingPolicy)?.set(row.state.episodeId, row);
  }

  const episodeIdSets = [...rowsByPolicy.values()].map((m) => new Set(m.keys()));
  const allEpisodeIds = new Set(rows.map((r) => r.state.episodeId));
  const completeIds = [...allEpisodeIds].sort().filter((id) => episodeIdSets.every((set) => set.has(id)));
  const requireRow = (map: Map<string, ProfitTakingComparisonRow> | undefined, id: string): ProfitTakingComparisonRow => {
    const row = map?.get(id);
    if (row === undefined) throw new Error('PROFIT_TAKING_COHORT_INVARIANT');
    return row;
  };
  const identifiedIds = completeIds.filter((id) => [...rowsByPolicy.values()].every((map) => {
    const row = requireRow(map, id);
    return row.counterfactualOutcomeState !== 'NOT_IDENTIFIABLE' && row.labelAvailableAt !== null;
  }));
  const truthClasses = new Set(identifiedIds.flatMap((id) => [...rowsByPolicy.values()].map((map) => requireRow(map, id).counterfactualOutcomeState)));
  if (truthClasses.size > 1) throw new Error('PROFIT_TAKING_MIXED_TRUTH_COHORT');
  const metricCohorts = Object.fromEntries(metricKeys.map((key) => [key, identifiedIds.filter((id) => [...rowsByPolicy.values()].every((map) => requireRow(map, id)[key] !== null))])) as Record<Metric, string[]>;
  const commonEpisodeIds = metricCohorts.incrementalWholeChainNetPnl;
  const excludedEpisodeIds = [...allEpisodeIds].sort().filter((id) => !commonEpisodeIds.includes(id));

  const perPolicy: ChallengerPolicyMetrics[] = canonicalV7ProfitTakingPolicies.map((policy) => {
    const mean = (key: Metric) => average(metricCohorts[key].map((id) => {
      const value = requireRow(rowsByPolicy.get(policy), id)[key];
      if (value === null) throw new Error('PROFIT_TAKING_METRIC_COHORT_INVARIANT');
      return value;
    }));
    return {
      policy, episodeCount: commonEpisodeIds.length,
      averageIncrementalWholeChainNetPnl: mean('incrementalWholeChainNetPnl'),
      averageIncrementalCapitalDays: mean('incrementalCapitalDays'),
      averageIncrementalDownside: mean('incrementalDownside'),
      averageIncrementalExecutionCost: mean('incrementalExecutionCost'),
    };
  });

  return {
    contractVersion: profitTakingChallengerRunnerVersion,
    commonEpisodeCount: commonEpisodeIds.length, excludedEpisodeIds, perPolicy,
    metricCohorts, truthClass: [...truthClasses][0] ?? null,
    numberOfTrials: canonicalV7ProfitTakingPolicies.length,
    trialIdentities: canonicalV7ProfitTakingPolicies.map((p) => `profit-taking-challenger::${p}`),
  };
}
