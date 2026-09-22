/**
 * R8 empirical continuation-value research INTERFACE (directive priority
 * #4/#7). Research-only, `brokerAuthority: false`. Answers
 * `management.empiricalContinuationValue`'s open status: this module
 * defines the CONTRACT a future estimator must satisfy -- feature/label
 * timing, censoring, purge/embargo, grouping, calibration, uncertainty
 * -- and provides test fixtures proving the contract composes correctly.
 * It deliberately implements NO fitted model of any kind, per explicit
 * instruction: "Build interfaces and test fixtures, not fake fitted
 * production models." Any concrete estimator is future work, gated on
 * real accumulated `ManagementOutcomeRecord`s
 * (`management-outcome-schema.ts`) existing first.
 */

export const continuationValueInterfaceVersion = 'theta-continuation-value-interface-v1' as const;

/** The six quantities `management.empiricalContinuationValue` needs,
 * named exactly as the directive specifies. Each is its OWN estimation
 * target -- never a single shared model pretending to answer all six. */
export type ContinuationValueTarget =
  | 'EV_HOLD' | 'EV_CLOSE' | 'EV_ROLL' | 'EV_ASSIGN' | 'EV_SELL_STOCK' | 'EV_SELL_CC';

/** Model-family hierarchy, simple-first per directive #20/#7. A future
 * estimator declares which family it is -- this module never picks one
 * for the caller, and a complex family requires the caller to justify
 * why a simpler one already failed OOS (enforced by convention/review,
 * not by this type system). */
export type ModelFamily =
  | 'EMPIRICAL_COHORT_MEAN' | 'REGULARIZED_REGRESSION' | 'LOGISTIC_PROBABILITY'
  | 'QUANTILE_REGRESSION' | 'SURVIVAL_RECOVERY_DURATION';

/**
 * The full governance contract a real estimator must document and
 * satisfy before ANY of its output may be treated as
 * `management.empiricalContinuationValue`. Every timestamp field exists
 * to make PIT-safety and leakage checkable, not merely asserted.
 */
export interface ContinuationValueEstimatorSpec {
  readonly target: ContinuationValueTarget;
  readonly modelFamily: ModelFamily;
  readonly specVersion: string;
  /** The exact instant features are allowed to be known by -- never
   * after `decisionTimestamp` on the record being scored. */
  readonly featureAvailabilityRule: 'AT_OR_BEFORE_DECISION_TIMESTAMP';
  /** The exact instant a training label is allowed to be known by --
   * mirrors `severe_drawdown_*`'s `label_available_at` convention
   * exactly, reused here rather than reinvented. */
  readonly labelAvailabilityRule: 'STRICTLY_AFTER_DECISION_TIMESTAMP';
  /** Required, explicit -- an estimator with no censoring policy is
   * invalid; an open/unresolved chain's outcome must never silently
   * become a training label. */
  readonly censoringPolicy: 'EXCLUDE_UNRESOLVED_CHAINS_FROM_TRAINING';
  /** Purge window in days -- any training row whose label matured within
   * this many days of the evaluation boundary is dropped, mirroring
   * `severe_drawdown_logistic_baseline.py`'s purge/embargo pattern. */
  readonly purgeWindowDays: number;
  readonly embargoWindowDays: number;
  /** The unit within which rows are treated as dependent, never
   * independent -- e.g. `'underlying_and_overlapping_decision_window'`,
   * matching this engagement's standing dependence-clustering
   * convention (never per-leg, never per-candidate). */
  readonly dependenceGroupingUnit: string;
  readonly calibrationMethod: 'RELIABILITY_BINS' | 'ISOTONIC' | 'NONE_YET_DEFINED';
  readonly uncertaintyMethod: 'BOOTSTRAP_CI' | 'ANALYTIC_SE' | 'NONE_YET_DEFINED';
}

export interface ContinuationValueEstimate {
  readonly target: ContinuationValueTarget;
  readonly chainId: string;
  readonly asOf: string;
  /** `null` until a real estimator satisfying the spec above produces a
   * value -- this module never fabricates one. */
  readonly value: number | null;
  readonly calibratedUncertainty: number | null;
  readonly specVersion: string;
  readonly rawN: number;
  readonly maturedN: number;
  readonly statisticalEffectiveN: number | null;
}

export function emptyContinuationValueEstimate(target: ContinuationValueTarget, chainId: string, asOf: string, specVersion: string): ContinuationValueEstimate {
  return { target, chainId, asOf, value: null, calibratedUncertainty: null, specVersion, rawN: 0, maturedN: 0, statisticalEffectiveN: null };
}

/**
 * Validates a spec is internally coherent BEFORE it is allowed to
 * produce any estimate: purge/embargo windows must be non-negative, and
 * `QUANTILE_REGRESSION`/`SURVIVAL_RECOVERY_DURATION` (the two more
 * complex families) require an explicit, non-placeholder calibration AND
 * uncertainty method -- `'NONE_YET_DEFINED'` is honest for the two
 * simplest families (a cohort mean or a plain regression may legitimately
 * not have settled on a calibration method yet) but is refused for the
 * more complex families, since deploying a more complex model without a
 * real calibration/uncertainty answer is exactly the "complexity without
 * demonstrated need" failure mode directive #20 warns against.
 */
export function validateEstimatorSpec(spec: ContinuationValueEstimatorSpec): { readonly valid: boolean; readonly reason: string | null } {
  if (spec.purgeWindowDays < 0 || spec.embargoWindowDays < 0) {
    return { valid: false, reason: 'PURGE_AND_EMBARGO_WINDOWS_MUST_BE_NON_NEGATIVE' };
  }
  const requiresRealCalibration: readonly ModelFamily[] = ['QUANTILE_REGRESSION', 'SURVIVAL_RECOVERY_DURATION'];
  if (requiresRealCalibration.includes(spec.modelFamily)
    && (spec.calibrationMethod === 'NONE_YET_DEFINED' || spec.uncertaintyMethod === 'NONE_YET_DEFINED')) {
    return { valid: false, reason: 'COMPLEX_MODEL_FAMILY_REQUIRES_A_REAL_CALIBRATION_AND_UNCERTAINTY_METHOD' };
  }
  return { valid: true, reason: null };
}
