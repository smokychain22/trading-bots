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
 * independent trades" rule, every report separates raw decision count,
 * distinct chain count, and independently justified research-unit count.
 * Distinct chains alone never become independent N.
 *
 * Grouping (by strategy/underlying/DTE/regime/etc.) is the CALLER's
 * responsibility -- this module accepts one already-filtered cohort at a
 * time and an optional passthrough `cohortKey` label describing how it
 * was grouped; it does not invent or own a grouping taxonomy.
 */
export interface ManagementCounterfactualCohortObservation {
  readonly analysis: ManagementCounterfactualAnalysis;
  /**
   * A versioned research grouping established outside this module. A chain ID
   * alone is not proof of statistical independence, so null keeps independent
   * N unknown. Repeated decisions from the same proven unit must reuse the
   * same identifier.
   */
  readonly independentUnitId: string | null;
}

export type SampleSizeState = 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_ASSESSED' | 'NONE';
export type CohortDataQualityState = 'COMPLETE' | 'PARTIAL' | 'NO_ECONOMIC_METRICS';

export interface ActionPairCohortStatistic {
  readonly selectedAction: string;
  readonly alternativeAction: string;
  /** Count of individual decisions where this pair was `COMPARABLE`. */
  readonly comparableDecisionCount: number;
  /** Distinct chains are reported separately and never called independent N. */
  readonly distinctChainCount: number;
  /** Null unless every comparable observation carries a proven unit ID. */
  readonly independentN: number | null;
  readonly meanNetPnlDifference: number | null;
  readonly medianNetPnlDifference: number | null;
  readonly netPnlStandardDeviation: number | null;
  readonly meanReturnPerCapitalDayDifference: number | null;
  readonly returnPerCapitalDayStandardDeviation: number | null;
  readonly meanMaxAdverseExcursionDifference: number | null;
  readonly maxAdverseExcursionStandardDeviation: number | null;
  readonly meanExecutionCostDifference: number | null;
  readonly executionCostStandardDeviation: number | null;
  readonly knownMetricCounts: Readonly<{
    netPnl: number;
    returnPerCapitalDay: number;
    maxAdverseExcursion: number;
    executionCost: number;
  }>;
  readonly dataQualityState: CohortDataQualityState;
  readonly uncertaintyState: 'DESCRIPTIVE_ONLY';
  /** `SUFFICIENT` only when proven `independentN >= minimumIndependentSample`
   * and at least one economic metric is known. Distinct chains alone never
   * establish independence.
   * `NONE` when there are zero comparable observations at all. This field
   * is the ONLY sample-size judgment this module makes; it is not, and
   * must never be read as, a promotion or applicability verdict. */
  readonly sampleSizeState: SampleSizeState;
}

export interface ManagementCounterfactualCohortReport {
  readonly contractVersion: typeof managementCounterfactualCohortVersion;
  readonly cohortKey: Readonly<Record<string, string>> | null;
  readonly decisionCount: number;
  readonly distinctChainCount: number;
  readonly independentN: number | null;
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
function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values) as number;
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
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
  const decisionIds = new Set<string>();
  for (const observation of observations) {
    if (decisionIds.has(observation.analysis.decisionId)) {
      throw new Error(`MANAGEMENT_COUNTERFACTUAL_COHORT_DUPLICATE_DECISION:${observation.analysis.decisionId}`);
    }
    decisionIds.add(observation.analysis.decisionId);
    if (observation.independentUnitId !== null && !observation.independentUnitId.trim()) {
      throw new Error('MANAGEMENT_COUNTERFACTUAL_COHORT_INDEPENDENT_UNIT_INVALID');
    }
  }
  const distinctChainCount = new Set(observations.map((observation) => observation.analysis.chainId)).size;
  const reportIndependenceKnown = observations.every((observation) => observation.independentUnitId !== null);
  const independentN = reportIndependenceKnown
    ? new Set(observations.map((observation) => observation.independentUnitId as string)).size : null;

  const rowsByPair = new Map<string, { selectedAction: string; alternativeAction: string; chainIds: Set<string>;
    independentUnitIds: Set<string>; independenceKnown: boolean; comparisonCount: number;
    netPnl: number[]; returnPerCapitalDay: number[]; maxAdverseExcursion: number[]; executionCost: number[] }>();
  for (const observation of observations) {
    for (const comparison of observation.analysis.comparisons) {
      if (comparison.state !== 'COMPARABLE') continue;
      const key = `${comparison.selectedAction}|${comparison.alternativeAction}`;
      const row = rowsByPair.get(key) ?? {
        selectedAction: comparison.selectedAction, alternativeAction: comparison.alternativeAction,
        chainIds: new Set<string>(), independentUnitIds: new Set<string>(), independenceKnown: true,
        comparisonCount: 0, netPnl: [], returnPerCapitalDay: [], maxAdverseExcursion: [], executionCost: [],
      };
      row.comparisonCount += 1;
      row.chainIds.add(observation.analysis.chainId);
      if (observation.independentUnitId === null) row.independenceKnown = false;
      else row.independentUnitIds.add(observation.independentUnitId);
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
      const metricCounts = {
        netPnl: row.netPnl.length, returnPerCapitalDay: row.returnPerCapitalDay.length,
        maxAdverseExcursion: row.maxAdverseExcursion.length, executionCost: row.executionCost.length,
      };
      const totalKnownMetrics = Object.values(metricCounts).reduce((sum, count) => sum + count, 0);
      const dataQualityState: CohortDataQualityState = totalKnownMetrics === 0 ? 'NO_ECONOMIC_METRICS'
        : Object.values(metricCounts).every((count) => count === row.comparisonCount) ? 'COMPLETE' : 'PARTIAL';
      const pairIndependentN = row.independenceKnown ? row.independentUnitIds.size : null;
      return {
        selectedAction: row.selectedAction, alternativeAction: row.alternativeAction,
        comparableDecisionCount: row.comparisonCount,
        distinctChainCount: row.chainIds.size,
        independentN: pairIndependentN,
        meanNetPnlDifference: mean(knownValues(row.netPnl)),
        medianNetPnlDifference: median(knownValues(row.netPnl)),
        netPnlStandardDeviation: sampleStandardDeviation(row.netPnl),
        meanReturnPerCapitalDayDifference: mean(knownValues(row.returnPerCapitalDay)),
        returnPerCapitalDayStandardDeviation: sampleStandardDeviation(row.returnPerCapitalDay),
        meanMaxAdverseExcursionDifference: mean(knownValues(row.maxAdverseExcursion)),
        maxAdverseExcursionStandardDeviation: sampleStandardDeviation(row.maxAdverseExcursion),
        meanExecutionCostDifference: mean(knownValues(row.executionCost)),
        executionCostStandardDeviation: sampleStandardDeviation(row.executionCost),
        knownMetricCounts: metricCounts, dataQualityState, uncertaintyState: 'DESCRIPTIVE_ONLY',
        sampleSizeState: row.comparisonCount === 0 ? 'NONE'
          : pairIndependentN === null || totalKnownMetrics === 0 ? 'NOT_ASSESSED'
            : pairIndependentN >= minimumIndependentSample ? 'SUFFICIENT' : 'INSUFFICIENT',
      } satisfies ActionPairCohortStatistic;
    });

  return {
    contractVersion: managementCounterfactualCohortVersion, cohortKey, decisionCount: observations.length,
    distinctChainCount, independentN, minimumIndependentSample, actionPairs, brokerAuthority: false,
  };
}
