/**
 * COMMAND 5C-7 item 35: profit-taking challenger runner. Evaluates all 17
 * canonical V7 challengers against the SAME set of resolved episodes,
 * with the same cost model / dependence grouping / outcome definitions --
 * avoids the cross-policy denominator drift the directive warns against
 * by restricting every policy's aggregate to the intersection of episodes
 * where EVERY policy has a resolved comparison row.
 */
import {
  type ProfitTakingComparisonRow, type V7ProfitTakingPolicy, canonicalV7ProfitTakingPolicies,
} from './profit-taking-experiment.js';

export const profitTakingChallengerRunnerVersion = 'theta-profit-taking-challenger-runner-v1' as const;

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
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
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
    rowsByPolicy.get(policy as V7ProfitTakingPolicy)?.set(row.state.episodeId, row);
  }

  const episodeIdSets = [...rowsByPolicy.values()].map((m) => new Set(m.keys()));
  const allEpisodeIds = new Set(rows.map((r) => r.state.episodeId));
  const commonEpisodeIds = [...allEpisodeIds].filter((id) => episodeIdSets.every((set) => set.has(id)));
  const excludedEpisodeIds = [...allEpisodeIds].filter((id) => !commonEpisodeIds.includes(id));

  const perPolicy: ChallengerPolicyMetrics[] = canonicalV7ProfitTakingPolicies.map((policy) => {
    const policyRows = commonEpisodeIds
      .map((id) => rowsByPolicy.get(policy)?.get(id))
      .filter((r): r is ProfitTakingComparisonRow => r !== undefined && r.counterfactualOutcomeState !== 'NOT_IDENTIFIABLE');
    return {
      policy, episodeCount: policyRows.length,
      averageIncrementalWholeChainNetPnl: average(policyRows.map((r) => r.incrementalWholeChainNetPnl).filter((v): v is number => v !== null)),
      averageIncrementalCapitalDays: average(policyRows.map((r) => r.incrementalCapitalDays).filter((v): v is number => v !== null)),
      averageIncrementalDownside: average(policyRows.map((r) => r.incrementalDownside).filter((v): v is number => v !== null)),
      averageIncrementalExecutionCost: average(policyRows.map((r) => r.incrementalExecutionCost).filter((v): v is number => v !== null)),
    };
  });

  return {
    contractVersion: profitTakingChallengerRunnerVersion,
    commonEpisodeCount: commonEpisodeIds.length, excludedEpisodeIds, perPolicy,
    numberOfTrials: canonicalV7ProfitTakingPolicies.length,
    trialIdentities: canonicalV7ProfitTakingPolicies.map((p) => `profit-taking-challenger::${p}`),
  };
}
