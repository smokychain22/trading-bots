/**
 * COMMAND 5C-7 item 45: real THETA-IQ dimension derivation from actual
 * dataset/evidence receipts -- `theta-iq-readiness-dimensions.ts`
 * (Command 5B) defined the 9 dimensions and structurally forbids
 * combining them; this module supplies the real functions that compute
 * each one, still never combined into a composite.
 */
import type { ReadinessDimension, ReadinessLevel } from './theta-iq-readiness-dimensions.js';

export const thetaIqDimensionDerivationVersion = 'theta-iq-dimension-derivation-v1' as const;

function levelFromCount(n: number, thresholds: { readonly partial: number; readonly substantial: number; readonly mature: number }): ReadinessLevel {
  if (n >= thresholds.mature) return 'MATURE';
  if (n >= thresholds.substantial) return 'SUBSTANTIAL';
  if (n >= thresholds.partial) return 'PARTIAL';
  return 'NONE';
}

export interface DimensionDerivationInputs {
  readonly distinctMarketStatesObserved: number;
  readonly strategiesWithAtLeastOneResolvedEpisode: number;
  readonly totalStrategyCount: number;
  readonly resolvedWholeChainCount: number;
  readonly totalWholeChainCount: number;
  readonly labelsAvailableCount: number;
  readonly totalLabelsExpectedCount: number;
  readonly independentEpisodeCount: number;
  readonly calibrationEvaluationsRun: number;
  readonly executionFillObservations: number;
  readonly managementDecisionsWithReturnToGo: number;
  readonly tailEventObservations: number;
}

/** Real, evidence-derived report -- every `numericMeasure` is an actual
 * computed rate/count, every `level` derived from it via a fixed,
 * pre-declared threshold ladder (never eyeballed per report). */
export function deriveThetaReadinessDimensions(inputs: DimensionDerivationInputs) {
  const strategyCoverageRate = inputs.totalStrategyCount === 0 ? null : inputs.strategiesWithAtLeastOneResolvedEpisode / inputs.totalStrategyCount;
  const outcomeCoverageRate = inputs.totalWholeChainCount === 0 ? null : inputs.resolvedWholeChainCount / inputs.totalWholeChainCount;
  const labelMaturityRate = inputs.totalLabelsExpectedCount === 0 ? null : inputs.labelsAvailableCount / inputs.totalLabelsExpectedCount;

  const dim = (numericMeasure: number | null, level: ReadinessLevel, evidence: string): ReadinessDimension => ({ level, evidence, numericMeasure });

  return {
    stateCoverage: dim(
      inputs.distinctMarketStatesObserved,
      levelFromCount(inputs.distinctMarketStatesObserved, { partial: 1, substantial: 20, mature: 100 }),
      `${inputs.distinctMarketStatesObserved} distinct market states observed.`,
    ),
    strategyCoverage: dim(
      strategyCoverageRate,
      strategyCoverageRate === null ? 'NONE' : levelFromCount(inputs.strategiesWithAtLeastOneResolvedEpisode, { partial: 1, substantial: 2, mature: 3 }),
      `${inputs.strategiesWithAtLeastOneResolvedEpisode}/${inputs.totalStrategyCount} strategies have at least one resolved episode.`,
    ),
    outcomeCoverage: dim(
      outcomeCoverageRate,
      outcomeCoverageRate === null ? 'NONE' : levelFromCount(inputs.resolvedWholeChainCount, { partial: 1, substantial: 30, mature: 200 }),
      `${inputs.resolvedWholeChainCount}/${inputs.totalWholeChainCount} whole chains resolved.`,
    ),
    labelMaturity: dim(
      labelMaturityRate,
      labelMaturityRate === null ? 'NONE' : levelFromCount(inputs.labelsAvailableCount, { partial: 1, substantial: 30, mature: 200 }),
      `${inputs.labelsAvailableCount}/${inputs.totalLabelsExpectedCount} expected labels available.`,
    ),
    independentN: dim(
      inputs.independentEpisodeCount,
      levelFromCount(inputs.independentEpisodeCount, { partial: 1, substantial: 30, mature: 200 }),
      `${inputs.independentEpisodeCount} independent episodes (dependence-grouped).`,
    ),
    calibrationReadiness: dim(
      inputs.calibrationEvaluationsRun,
      levelFromCount(inputs.calibrationEvaluationsRun, { partial: 1, substantial: 5, mature: 20 }),
      `${inputs.calibrationEvaluationsRun} calibration evaluations run.`,
    ),
    executionModelReadiness: dim(
      inputs.executionFillObservations,
      levelFromCount(inputs.executionFillObservations, { partial: 1, substantial: 30, mature: 200 }),
      `${inputs.executionFillObservations} real fill observations.`,
    ),
    managementEvidence: dim(
      inputs.managementDecisionsWithReturnToGo,
      levelFromCount(inputs.managementDecisionsWithReturnToGo, { partial: 1, substantial: 30, mature: 200 }),
      `${inputs.managementDecisionsWithReturnToGo} management decisions with a real realized return-to-go.`,
    ),
    tailRiskEvidence: dim(
      inputs.tailEventObservations,
      levelFromCount(inputs.tailEventObservations, { partial: 1, substantial: 5, mature: 20 }),
      `${inputs.tailEventObservations} real tail-event observations.`,
    ),
  };
}
