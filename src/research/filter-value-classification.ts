/**
 * COMMAND 5B item 11: filter-value research framework. Research-only,
 * `brokerAuthority: false`. For each of the 20 canonical `thetaFeatureFamily`
 * values, a real analysis contract capable of eventually classifying
 * whether that family's filtering/ranking role is empirically supported --
 * NOT a computed conclusion (no real resolved episodes exist yet). Every
 * family defaults to `INSUFFICIENT_DATA` until a real, cited analysis run
 * supplies otherwise; this module makes that the honest structural default,
 * not a special case a caller must remember to set.
 *
 * Reuses Command 4's `purge-embargo-contract.ts` / `dependence-grouping-
 * contract.ts` for the paired-ablation/regime-stratified analysis this
 * classification requires -- this module does not reimplement purge,
 * embargo, or dependence grouping.
 */

export const filterValueClassificationVersion = 'theta-filter-value-classification-v1' as const;

export type CanonicalFeatureFamily =
  | 'LIQUIDITY' | 'OWNERSHIP' | 'DRAWDOWN_RECOVERY' | 'TREND' | 'MOMENTUM'
  | 'REALIZED_VOLATILITY' | 'IV' | 'SKEW' | 'TERM_STRUCTURE' | 'VOLATILITY_SURFACE'
  | 'FLOW' | 'UNUSUAL_ACTIVITY' | 'VOLUME_OPEN_INTEREST' | 'EVENT_CONTEXT' | 'SECTOR'
  | 'CORRELATION' | 'PORTFOLIO_EXPOSURE' | 'FUNDAMENTAL_QUALITY' | 'REGIME' | 'EXECUTION_QUALITY';

export const ALL_CANONICAL_FEATURE_FAMILIES: readonly CanonicalFeatureFamily[] = [
  'LIQUIDITY', 'OWNERSHIP', 'DRAWDOWN_RECOVERY', 'TREND', 'MOMENTUM',
  'REALIZED_VOLATILITY', 'IV', 'SKEW', 'TERM_STRUCTURE', 'VOLATILITY_SURFACE',
  'FLOW', 'UNUSUAL_ACTIVITY', 'VOLUME_OPEN_INTEREST', 'EVENT_CONTEXT', 'SECTOR',
  'CORRELATION', 'PORTFOLIO_EXPOSURE', 'FUNDAMENTAL_QUALITY', 'REGIME', 'EXECUTION_QUALITY',
];

export type FilterValueVerdict =
  | 'VALUE_SUPPORTED' | 'VALUE_NOT_DEMONSTRATED' | 'POSSIBLY_OVERRESTRICTIVE'
  | 'SAFETY_ONLY_NOT_ALPHA' | 'INSUFFICIENT_DATA' | 'CONFOUNDED' | 'NOT_IDENTIFIABLE';

export interface FilterValueAnalysisMethod {
  readonly pairedAblationUsed: boolean;
  readonly matchedSamplesUsed: boolean;
  readonly regimeStratified: boolean;
  readonly purgedWalkForwardVersion: string | null;
  readonly dependenceGroupingVersion: string | null;
  readonly costAware: boolean;
}

export interface FilterValueClassification {
  readonly contractVersion: typeof filterValueClassificationVersion;
  readonly family: CanonicalFeatureFamily;
  readonly verdict: FilterValueVerdict;
  /** null until a real analysis has been run -- never fabricated. */
  readonly independentN: number | null;
  readonly effectSize: number | null;
  readonly confidenceIntervalLow: number | null;
  readonly confidenceIntervalHigh: number | null;
  readonly method: FilterValueAnalysisMethod;
  readonly evaluatedAt: string | null;
  readonly notes: string | null;
}

/** The honest default for every family before any real analysis has been
 * run -- `INSUFFICIENT_DATA`, not a guess, and not something a caller must
 * remember to set explicitly. */
export function insufficientDataClassification(family: CanonicalFeatureFamily): FilterValueClassification {
  return {
    contractVersion: filterValueClassificationVersion,
    family,
    verdict: 'INSUFFICIENT_DATA',
    independentN: null, effectSize: null, confidenceIntervalLow: null, confidenceIntervalHigh: null,
    method: {
      pairedAblationUsed: false, matchedSamplesUsed: false, regimeStratified: false,
      purgedWalkForwardVersion: null, dependenceGroupingVersion: null, costAware: false,
    },
    evaluatedAt: null,
    notes: 'No real analysis has been run against real resolved episodes yet.',
  };
}

/** All 20 families, each defaulting to `INSUFFICIENT_DATA` -- the honest
 * starting registry a real analysis run will later selectively overwrite. */
export function buildInitialFilterValueRegistry(): ReadonlyMap<CanonicalFeatureFamily, FilterValueClassification> {
  return new Map(ALL_CANONICAL_FEATURE_FAMILIES.map((f) => [f, insufficientDataClassification(f)]));
}

/**
 * Records a real classification. Requires the analysis method to have
 * actually used at least a paired-ablation or matched-sample design with a
 * purged-walk-forward version before any verdict OTHER than
 * `INSUFFICIENT_DATA`/`NOT_IDENTIFIABLE`/`CONFOUNDED` can be recorded --
 * a naive "filter rejected N, M later moved favorably" comparison (the
 * directive's own explicit anti-pattern) cannot produce `VALUE_SUPPORTED`
 * or `VALUE_NOT_DEMONSTRATED` through this function.
 */
export function recordFilterValueClassification(input: Omit<FilterValueClassification, 'contractVersion'>): FilterValueClassification {
  const requiresRealMethod: readonly FilterValueVerdict[] = ['VALUE_SUPPORTED', 'VALUE_NOT_DEMONSTRATED', 'POSSIBLY_OVERRESTRICTIVE', 'SAFETY_ONLY_NOT_ALPHA'];
  if (requiresRealMethod.includes(input.verdict)) {
    const hasRealDesign = input.method.pairedAblationUsed || input.method.matchedSamplesUsed;
    if (!hasRealDesign || input.method.purgedWalkForwardVersion === null) {
      throw new Error(`FILTER_VALUE_NAIVE_ANALYSIS_REJECTED:${input.family}:${input.verdict}`);
    }
    if (input.independentN === null || input.evaluatedAt === null) {
      throw new Error(`FILTER_VALUE_VERDICT_WITHOUT_REAL_EVIDENCE:${input.family}:${input.verdict}`);
    }
  }
  return { contractVersion: filterValueClassificationVersion, ...input };
}
