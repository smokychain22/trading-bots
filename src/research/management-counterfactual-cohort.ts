import type { ManagementCounterfactualAnalysis } from './management-counterfactual-analysis.js';

export const managementCounterfactualCohortVersion = 'theta-management-counterfactual-cohort-v1' as const;

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO decision authority of any kind -- it never selects an action, never
 * reports a "winner," never gates anything, and has no applicability/
 * eligibility verdict field. It is a pure DESCRIPTIVE STATISTICS layer
 * over the ALREADY-CANONICAL `analyzeManagementCounterfactuals` output
 * (`management-counterfactual-analysis.ts`, which already enforces PIT
 * safety, leakage rejection, and comparability state per decision) --
 * this module recomputes none of that, it only aggregates already-
 * validated per-decision comparisons into cohort-level means/medians with
 * an explicit, caller-justified sample-sufficiency label.
 *
 * Per the standing "20 management decisions from one chain are not 20
 * independent trades" rule, every report tracks `independentChainCount`
 * (distinct `chainId` values) SEPARATELY from `decisionCount` (raw row
 * count) -- a caller must look at the independent count, never the raw
 * count, when judging whether a cohort result is meaningful.
 *
 * Grouping (by strategy/underlying/DTE/regime/etc.) is the CALLER's
 * responsibility -- this module accepts one already-filtered cohort at a
 * time and an optional passthrough `cohortKey` label describing how it
 * was grouped; it does not invent or own a grouping taxonomy.
 */
export interface ManagementCounterfactualCohortObservation {
  readonly analysis: ManagementCounterfactualAnalysis;
}

export type SampleSizeState = 'SUFFICIENT' | 'INSUFFICIENT' | 'NONE';

export interface ActionPairCohortStatistic {
  readonly selectedAction: string;
  readonly alternativeAction: string;
  /** Count of individual decisions where this pair was `COMPARABLE`. */
  readonly comparableDecisionCount: number;
  /** Distinct `chainId` values among the comparable decisions above --
   * the number that actually matters for sample-sufficiency judgment. */
  readonly independentChainCount: number;
  readonly meanNetPnlDifference: number | null;
  readonly medianNetPnlDifference: number | null;
  readonly meanReturnPerCapitalDayDifference: number | null;
  readonly meanMaxAdverseExcursionDifference: number | null;
  readonly meanExecutionCostDifference: number | null;
  /** `SUFFICIENT` only when `independentChainCount >= minimumIndependentSample`
   * (a required, caller-justified input -- never invented internally).
   * `NONE` when there are zero comparable observations at all. This field
   * is the ONLY sample-size judgment this module makes; it is not, and
   * must never be read as, a promotion or applicability verdict. */
  readonly sampleSizeState: SampleSizeState;
}

export interface ManagementCounterfactualCohortReport {
  readonly contractVersion: typeof managementCounterfactualCohortVersion;
  readonly cohortKey: Readonly<Record<string, string>> | null;
  readonly decisionCount: number;
  readonly independentChainCount: number;
  readonly minimumIndependentSample: number;
  readonly actionPairs: readonly ActionPairCohortStatistic[];
  readonly brokerAuthority: false;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
function knownValues(values: readonly (number | null)[]): readonly number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/**
 * Aggregates one already-filtered cohort's canonical per-decision
 * counterfactual analyses into descriptive statistics per action pair.
 * `minimumIndependentSample` is required and caller-justified -- this
 * module never invents a sample-size floor.
 */
export function buildManagementCounterfactualCohortReport(
  observations: readonly ManagementCounterfactualCohortObservation[],
  minimumIndependentSample: number,
  cohortKey: Readonly<Record<string, string>> | null = null,
): ManagementCounterfactualCohortReport {
  if (!Number.isInteger(minimumIndependentSample) || minimumIndependentSample <= 0) {
    throw new Error('MANAGEMENT_COUNTERFACTUAL_COHORT_MINIMUM_SAMPLE_INVALID');
  }
  const independentChainCount = new Set(observations.map((observation) => observation.analysis.chainId)).size;

  const rowsByPair = new Map<string, { selectedAction: string; alternativeAction: string; chainIds: Set<string>;
    netPnl: number[]; returnPerCapitalDay: number[]; maxAdverseExcursion: number[]; executionCost: number[] }>();
  for (const observation of observations) {
    for (const comparison of observation.analysis.comparisons) {
      if (comparison.state !== 'COMPARABLE') continue;
      const key = `${comparison.selectedAction}|${comparison.alternativeAction}`;
      const row = rowsByPair.get(key) ?? {
        selectedAction: comparison.selectedAction, alternativeAction: comparison.alternativeAction,
        chainIds: new Set<string>(), netPnl: [], returnPerCapitalDay: [], maxAdverseExcursion: [], executionCost: [],
      };
      row.chainIds.add(observation.analysis.chainId);
      if (comparison.netPnlDifference !== null && Number.isFinite(comparison.netPnlDifference)) row.netPnl.push(comparison.netPnlDifference);
      if (comparison.returnPerCapitalDayDifference !== null && Number.isFinite(comparison.returnPerCapitalDayDifference)) {
        row.returnPerCapitalDay.push(comparison.returnPerCapitalDayDifference);
      }
      if (comparison.maxAdverseExcursionDifference !== null && Number.isFinite(comparison.maxAdverseExcursionDifference)) {
        row.maxAdverseExcursion.push(comparison.maxAdverseExcursionDifference);
      }
      if (comparison.executionCostDifference !== null && Number.isFinite(comparison.executionCostDifference)) {
        row.executionCost.push(comparison.executionCostDifference);
      }
      rowsByPair.set(key, row);
    }
  }

  const actionPairs: ActionPairCohortStatistic[] = [...rowsByPair.values()]
    .sort((left, right) => `${left.selectedAction}|${left.alternativeAction}`.localeCompare(`${right.selectedAction}|${right.alternativeAction}`))
    .map((row) => {
      const pairIndependentChainCount = row.chainIds.size;
      return {
        selectedAction: row.selectedAction, alternativeAction: row.alternativeAction,
        comparableDecisionCount: row.netPnl.length > 0 || row.returnPerCapitalDay.length > 0
          || row.maxAdverseExcursion.length > 0 || row.executionCost.length > 0
          ? Math.max(row.netPnl.length, row.returnPerCapitalDay.length, row.maxAdverseExcursion.length, row.executionCost.length)
          : 0,
        independentChainCount: pairIndependentChainCount,
        meanNetPnlDifference: mean(knownValues(row.netPnl)),
        medianNetPnlDifference: median(knownValues(row.netPnl)),
        meanReturnPerCapitalDayDifference: mean(knownValues(row.returnPerCapitalDay)),
        meanMaxAdverseExcursionDifference: mean(knownValues(row.maxAdverseExcursion)),
        meanExecutionCostDifference: mean(knownValues(row.executionCost)),
        sampleSizeState: pairIndependentChainCount === 0 ? 'NONE'
          : pairIndependentChainCount >= minimumIndependentSample ? 'SUFFICIENT' : 'INSUFFICIENT',
      } satisfies ActionPairCohortStatistic;
    });

  return {
    contractVersion: managementCounterfactualCohortVersion, cohortKey, decisionCount: observations.length,
    independentChainCount, minimumIndependentSample, actionPairs, brokerAuthority: false,
  };
}
