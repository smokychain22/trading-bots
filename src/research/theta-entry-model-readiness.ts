/**
 * THETA entry model readiness framework (Wave 17 section 3). Research-
 * only, `brokerAuthority: false`. Governs whether an entry baseline
 * model (regularized logistic, calibrated tree/GBM, quantile downside)
 * is even allowed to claim a training/evaluation result, based on real
 * dataset sufficiency -- this module never trains a model itself (no ML
 * runtime dependency here), it only gates readiness and structures the
 * real evaluation metric contract a future model-training pass must
 * populate.
 */

export const thetaEntryModelReadinessVersion = 'theta-entry-model-readiness-v1' as const;

export type EntryModelFamily = 'REGULARIZED_LOGISTIC' | 'CALIBRATED_TREE' | 'GRADIENT_BOOSTED_BASELINE' | 'QUANTILE_DOWNSIDE';
export type EntryModelTarget = 'P_WHOLE_CHAIN_PROFITABLE' | 'EXPECTED_WHOLE_CHAIN_NET_PNL' | 'P_ASSIGNMENT' | 'EXPECTED_CAPITAL_DAYS' | 'DOWNSIDE_P01' | 'DOWNSIDE_P05' | 'DOWNSIDE_P10' | 'DOWNSIDE_P25';
export type ReadinessState = 'DATASET_NOT_READY' | 'INSUFFICIENT_EFFECTIVE_N' | 'TRAINING_READY' | 'TRAINED' | 'CALIBRATION_FAILED' | 'OOS_FAILED' | 'OOS_SUPPORTED';

export interface DatasetSufficiencyInput {
  readonly rawRowCount: number;
  readonly resolvedLabelRowCount: number;
  readonly censoredRowCount: number;
  /** Independent effective N -- after accounting for same-chain and
   * same-underlying dependence. Never assumed equal to rawRowCount. */
  readonly effectiveIndependentN: number;
  readonly minimumEffectiveN: number;
  readonly distinctUnderlyingCount: number;
  readonly minimumDistinctUnderlyings: number;
}

export interface EvaluationMetrics {
  readonly brierScore: number | null;
  readonly logLoss: number | null;
  readonly calibrationSlope: number | null;
  readonly calibrationIntercept: number | null;
  readonly expectedNetPnl: number | null;
  readonly medianNetPnl: number | null;
  readonly profitFactor: number | null;
  readonly avgWin: number | null;
  readonly avgLoss: number | null;
  readonly expectedShortfall: number | null;
  readonly maxDrawdown: number | null;
  readonly capitalDays: number | null;
  readonly rpcd: number | null;
  readonly effectiveIndependentN: number;
}

export interface EntryModelReadinessAssessment {
  readonly contractVersion: typeof thetaEntryModelReadinessVersion;
  readonly modelFamily: EntryModelFamily;
  readonly target: EntryModelTarget;
  readonly asOf: string;
  readonly state: ReadinessState;
  readonly reason: string;
  readonly sufficiency: DatasetSufficiencyInput;
  readonly evaluation: EvaluationMetrics | null;
  /** True only when OOS evidence shows real incremental value over the
   * simplest baseline -- never true merely because a metric looks good
   * in isolation. Advanced-model families (HMM/survival/LSTM/etc.) are
   * out of scope for this module entirely; it only governs the 4
   * baseline families. */
  readonly promotionEligible: boolean;
}

/**
 * Assesses whether a model family/target combination is allowed to be
 * trained/evaluated at all, from real dataset sufficiency inputs. Never
 * advances past `DATASET_NOT_READY`/`INSUFFICIENT_EFFECTIVE_N` without
 * real, caller-supplied evidence that both effective-N and
 * underlying-diversity minimums are met.
 */
export function assessEntryModelReadiness(input: {
  readonly modelFamily: EntryModelFamily;
  readonly target: EntryModelTarget;
  readonly asOf: string;
  readonly sufficiency: DatasetSufficiencyInput;
  /** Only supplied once real training/evaluation has actually happened.
   * Supplying this with insufficient data throws -- this module refuses
   * to accept a "trained" claim it cannot verify was gated correctly. */
  readonly evaluation?: EvaluationMetrics;
  readonly oosSupported?: boolean;
}): EntryModelReadinessAssessment {
  if (!Number.isFinite(Date.parse(input.asOf))) throw new Error('INVALID_ASOF');
  const s = input.sufficiency;
  for (const [name, value] of [
    ['rawRowCount', s.rawRowCount], ['resolvedLabelRowCount', s.resolvedLabelRowCount], ['censoredRowCount', s.censoredRowCount],
    ['effectiveIndependentN', s.effectiveIndependentN], ['minimumEffectiveN', s.minimumEffectiveN],
    ['distinctUnderlyingCount', s.distinctUnderlyingCount], ['minimumDistinctUnderlyings', s.minimumDistinctUnderlyings],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`INVALID_SUFFICIENCY_FIELD:${name}`);
  }
  if (s.resolvedLabelRowCount + s.censoredRowCount > s.rawRowCount) throw new Error('SUFFICIENCY_COUNTS_INCONSISTENT');

  if (s.rawRowCount === 0) {
    return {
      contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'DATASET_NOT_READY', reason: 'Zero raw rows -- dataset does not exist yet.', sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  const insufficientN = s.effectiveIndependentN < s.minimumEffectiveN || s.distinctUnderlyingCount < s.minimumDistinctUnderlyings;
  if (insufficientN) {
    if (input.evaluation !== undefined) throw new Error('EVALUATION_SUPPLIED_DESPITE_INSUFFICIENT_N');
    return {
      contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'INSUFFICIENT_EFFECTIVE_N',
      reason: `effectiveIndependentN=${s.effectiveIndependentN} (min ${s.minimumEffectiveN}) or distinctUnderlyingCount=${s.distinctUnderlyingCount} (min ${s.minimumDistinctUnderlyings}) below policy minimum.`,
      sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  if (input.evaluation === undefined) {
    return {
      contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'TRAINING_READY', reason: 'Sufficiency minimums met; no evaluation supplied yet.', sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  if (input.evaluation.effectiveIndependentN !== s.effectiveIndependentN) throw new Error('EVALUATION_N_MISMATCH');
  const calibrationOk = input.evaluation.calibrationSlope !== null && input.evaluation.calibrationIntercept !== null
    && Math.abs(input.evaluation.calibrationSlope - 1) < 0.25 && Math.abs(input.evaluation.calibrationIntercept) < 0.1;
  if (!calibrationOk) {
    return {
      contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'CALIBRATION_FAILED', reason: 'Calibration slope/intercept outside real acceptance bounds, or not supplied.',
      sufficiency: s, evaluation: input.evaluation, promotionEligible: false,
    };
  }
  if (input.oosSupported !== true) {
    return {
      contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'TRAINED', reason: 'Calibration passed; OOS support not yet confirmed.', sufficiency: s, evaluation: input.evaluation, promotionEligible: false,
    };
  }
  return {
    contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
    state: 'OOS_SUPPORTED', reason: 'Calibration passed and real OOS support confirmed.',
    sufficiency: s, evaluation: input.evaluation, promotionEligible: true,
  };
}
