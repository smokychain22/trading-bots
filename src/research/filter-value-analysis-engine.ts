/**
 * COMMAND 5C-7 item 29: runnable filter-value analysis machinery. Real
 * paired-ablation/matched-comparison statistics, cost-aware (via
 * `return-normalization.ts`) and dependence-grouping-aware (via
 * `dependence-grouping-contract.ts`), feeding `filter-value-
 * classification.ts`'s real-method gate with actually-computed evidence
 * rather than caller-asserted numbers. This module is the "engine";
 * `filter-value-classification.ts` remains the typed contract/gate.
 *
 * COMMAND 5C-7 closure item 3 -- explicit decision: this ONE generic,
 * `CanonicalFeatureFamily`-parameterized engine is used for all 20
 * canonical families, not 20 bespoke runners. Justification: every
 * family's real analysis question is structurally identical --
 * "does presence/level of family X shift the same normalized-return
 * outcome, holding matched confounders constant, under a purged
 * walk-forward split?" -- the family-specific work lives entirely in how
 * a caller builds `MatchedAblationPair`s (which raw fields to match on,
 * what "presence" means for that family), not in the statistical engine
 * itself; a bespoke per-family engine would duplicate this exact math 20
 * times for zero real gain. (`optionomics-flow-analysis-engine.ts` is a
 * deliberate, justified EXCEPTION for FLOW specifically, because flow has
 * genuinely bespoke semantics -- open/close ambiguity, sweep/block
 * structure -- that a generic numeric pair can't express; see that
 * module's own docstring.) Proven generic (not just asserted) by
 * `tests/filter-value-analysis-engine.test.ts`'s LIQUIDITY/REGIME cases,
 * run through the identical `runFilterValueAnalysis` path FLOW uses.
 */
import {
  type CanonicalFeatureFamily, type FilterValueClassification, type FilterValueVerdict,
  recordFilterValueClassification,
} from './filter-value-classification.js';

export const filterValueAnalysisEngineVersion = 'theta-filter-value-analysis-engine-v1' as const;

/** One matched pair: the same underlying/DTE/delta/regime cohort, one
 * observation WITH the feature present/high, one WITHOUT/low -- paired so
 * within-pair market conditions are held roughly constant. Both sides use
 * the SAME return-normalization basis (enforced by the caller building
 * these from `buildNormalizedReturnSeries`). */
export interface MatchedAblationPair {
  readonly pairId: string;
  readonly chainIdWithFeature: string;
  readonly chainIdWithoutFeature: string;
  readonly normalizedReturnWithFeature: number;
  readonly normalizedReturnWithoutFeature: number;
}

export interface PairedAblationStatistics {
  readonly n: number;
  readonly meanDifference: number;
  readonly standardError: number | null;
  readonly effectSize: number | null;
  readonly confidenceIntervalLow: number | null;
  readonly confidenceIntervalHigh: number | null;
}

/**
 * Real paired mean-difference statistics: mean of within-pair differences,
 * standard error via sample standard deviation of the differences (n-1
 * denominator), a 95% CI using the normal approximation (z=1.96 -- exact
 * matching the Wald-interval convention this repo already uses
 * elsewhere), and an effect size (mean difference / standard deviation of
 * differences, i.e. a paired Cohen's d). All three of standardError/
 * effectSize/CI are `null` (never fabricated) when n < 2 or the sample
 * has zero variance.
 */
export function computePairedAblationStatistics(pairs: readonly MatchedAblationPair[]): PairedAblationStatistics {
  const n = pairs.length;
  if (n === 0) return { n: 0, meanDifference: 0, standardError: null, effectSize: null, confidenceIntervalLow: null, confidenceIntervalHigh: null };
  const differences = pairs.map((p) => p.normalizedReturnWithFeature - p.normalizedReturnWithoutFeature);
  const meanDifference = differences.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, meanDifference, standardError: null, effectSize: null, confidenceIntervalLow: null, confidenceIntervalHigh: null };
  const variance = differences.reduce((sum, d) => sum + (d - meanDifference) ** 2, 0) / (n - 1);
  if (variance <= 0) return { n, meanDifference, standardError: null, effectSize: null, confidenceIntervalLow: null, confidenceIntervalHigh: null };
  const standardDeviation = Math.sqrt(variance);
  const standardError = standardDeviation / Math.sqrt(n);
  const effectSize = meanDifference / standardDeviation;
  const z = 1.96;
  return {
    n, meanDifference, standardError, effectSize,
    confidenceIntervalLow: meanDifference - z * standardError,
    confidenceIntervalHigh: meanDifference + z * standardError,
  };
}

export interface FilterValueAnalysisRun {
  readonly family: CanonicalFeatureFamily;
  readonly pairs: readonly MatchedAblationPair[];
  readonly regimeStratified: boolean;
  readonly purgedWalkForwardVersion: string;
  readonly dependenceGroupingVersion: string;
  readonly costAware: boolean;
  readonly evaluatedAt: string;
  /** Minimum independent N before a real verdict (other than
   * INSUFFICIENT_DATA) may be drawn -- caller-supplied, never a magic
   * constant invented here (see COMMAND 5C-7 §18's sample-size
   * governance requirement). */
  readonly minimumIndependentN: number;
  /** Effect-size threshold below which a statistically-resolvable
   * result is still classified VALUE_NOT_DEMONSTRATED rather than
   * VALUE_SUPPORTED -- caller-supplied and pre-registered, never tuned
   * after seeing the result. */
  readonly minimumMeaningfulEffectSize: number;
}

/**
 * Runs a real paired-ablation analysis and returns a genuine
 * `FilterValueClassification` -- either a real verdict (backed by
 * computed statistics) or an honest `INSUFFICIENT_DATA`/`CONFOUNDED` when
 * the evidence does not support a stronger claim. This function is the
 * "runnable with real data later without new code" machinery the
 * directive requires -- it is exercised here only against fixtures
 * (COMMAND 5C-7's own discipline: zero real resolved episodes exist yet).
 */
export function runFilterValueAnalysis(run: FilterValueAnalysisRun): FilterValueClassification {
  const stats = computePairedAblationStatistics(run.pairs);
  const method = {
    pairedAblationUsed: true, matchedSamplesUsed: true, regimeStratified: run.regimeStratified,
    purgedWalkForwardVersion: run.purgedWalkForwardVersion, dependenceGroupingVersion: run.dependenceGroupingVersion,
    costAware: run.costAware,
  };
  if (stats.n < run.minimumIndependentN || stats.effectSize === null) {
    return recordFilterValueClassification({
      family: run.family, verdict: 'INSUFFICIENT_DATA', independentN: stats.n, effectSize: stats.effectSize,
      confidenceIntervalLow: stats.confidenceIntervalLow, confidenceIntervalHigh: stats.confidenceIntervalHigh,
      method: { pairedAblationUsed: false, matchedSamplesUsed: false, regimeStratified: false, purgedWalkForwardVersion: null, dependenceGroupingVersion: null, costAware: false },
      evaluatedAt: null, notes: `n=${stats.n} below minimumIndependentN=${run.minimumIndependentN}, or zero-variance sample.`,
    });
  }
  if (!run.regimeStratified) {
    return recordFilterValueClassification({
      family: run.family, verdict: 'CONFOUNDED', independentN: stats.n, effectSize: stats.effectSize,
      confidenceIntervalLow: stats.confidenceIntervalLow, confidenceIntervalHigh: stats.confidenceIntervalHigh,
      method: { pairedAblationUsed: false, matchedSamplesUsed: false, regimeStratified: false, purgedWalkForwardVersion: null, dependenceGroupingVersion: null, costAware: false },
      evaluatedAt: null, notes: 'Not regime-stratified -- a real effect cannot yet be separated from regime concentration.',
    });
  }
  const ciExcludesZero = stats.confidenceIntervalLow !== null && stats.confidenceIntervalHigh !== null
    && (stats.confidenceIntervalLow > 0 || stats.confidenceIntervalHigh < 0);
  const meaningfulEffect = Math.abs(stats.effectSize) >= run.minimumMeaningfulEffectSize;
  const verdict: FilterValueVerdict = ciExcludesZero && meaningfulEffect ? 'VALUE_SUPPORTED' : 'VALUE_NOT_DEMONSTRATED';
  return recordFilterValueClassification({
    family: run.family, verdict, independentN: stats.n, effectSize: stats.effectSize,
    confidenceIntervalLow: stats.confidenceIntervalLow, confidenceIntervalHigh: stats.confidenceIntervalHigh,
    method, evaluatedAt: run.evaluatedAt,
    notes: ciExcludesZero ? 'CI excludes zero.' : 'CI includes zero -- no statistically resolvable effect.',
  });
}
