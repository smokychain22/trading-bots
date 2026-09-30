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
export const entryModelFamilies: readonly EntryModelFamily[] = [
  'REGULARIZED_LOGISTIC', 'CALIBRATED_TREE', 'GRADIENT_BOOSTED_BASELINE', 'QUANTILE_DOWNSIDE',
];
export type EntryModelTarget = 'P_WHOLE_CHAIN_PROFITABLE' | 'EXPECTED_WHOLE_CHAIN_NET_PNL' | 'P_ASSIGNMENT' | 'EXPECTED_CAPITAL_DAYS' | 'DOWNSIDE_P01' | 'DOWNSIDE_P05' | 'DOWNSIDE_P10' | 'DOWNSIDE_P25';
export const entryModelTargets: readonly EntryModelTarget[] = ['P_WHOLE_CHAIN_PROFITABLE', 'EXPECTED_WHOLE_CHAIN_NET_PNL', 'P_ASSIGNMENT', 'EXPECTED_CAPITAL_DAYS', 'DOWNSIDE_P01', 'DOWNSIDE_P05', 'DOWNSIDE_P10', 'DOWNSIDE_P25'];
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

/** Paired, held-out rows. This verifies a comparison, not external data authenticity. */
export interface EntryOosComparison {
  readonly policyVersion: string;
  readonly frozenAt: string;
  readonly trainingEnd: string;
  readonly validationEnd: string;
  readonly embargoSeconds: number;
  readonly minimumPairedRows: number;
  readonly minimumLossImprovement: number;
  readonly fittingRowIds: readonly string[];
  readonly rows: readonly {
    observationId: string; decisionAt: string; featureAvailableAt: string; labelAvailableAt: string;
    prediction: number; baselinePrediction: number; outcome: number;
  }[];
}

export function evaluateEntryOosComparison(target: EntryModelTarget, evidence: EntryOosComparison, asOf: string): {
  supported: boolean; pairedN: number; modelLoss: number; baselineLoss: number; metric: string;
} {
  if (!entryModelTargets.includes(target)) throw new Error('OOS_TARGET_INVALID');
  const time = (s: string): number => { const n = Date.parse(s); if (!Number.isFinite(n)) throw new Error('OOS_INVALID_TIME'); return n; };
  if (!evidence.policyVersion?.trim() || !Number.isSafeInteger(evidence.minimumPairedRows) || evidence.minimumPairedRows < 1 ||
    !Number.isFinite(evidence.minimumLossImprovement) || evidence.minimumLossImprovement < 0 ||
    !Number.isSafeInteger(evidence.embargoSeconds) || evidence.embargoSeconds < 0) throw new Error('OOS_EXPLICIT_POLICY_REQUIRED');
  const frozen = time(evidence.frozenAt), train = time(evidence.trainingEnd), validation = time(evidence.validationEnd);
  if (frozen > train || validation <= train || !evidence.fittingRowIds.length || !evidence.rows.length) throw new Error('OOS_PARTITIONS_REQUIRED');
  const ids = new Set(evidence.fittingRowIds);
  if (ids.size !== evidence.fittingRowIds.length || evidence.fittingRowIds.some((id) => !id.trim())) throw new Error('OOS_FIT_IDENTITIES_INVALID');
  const binary = target.startsWith('P_');
  const quantile = ({ DOWNSIDE_P01: 0.01, DOWNSIDE_P05: 0.05, DOWNSIDE_P10: 0.1, DOWNSIDE_P25: 0.25 } as Partial<Record<EntryModelTarget, number>>)[target];
  const loss = (prediction: number, actual: number): number => quantile === undefined ? (prediction - actual) ** 2
    : Math.max(quantile * (actual - prediction), (quantile - 1) * (actual - prediction));
  let modelLoss = 0, baselineLoss = 0;
  for (const row of evidence.rows) {
    if (!row.observationId.trim() || ids.has(row.observationId)) throw new Error('OOS_DUPLICATE_OR_FITTING_OVERLAP');
    ids.add(row.observationId);
    const decision = time(row.decisionAt);
    if (decision <= validation + evidence.embargoSeconds * 1000 || time(row.featureAvailableAt) > decision ||
      time(row.labelAvailableAt) < decision || time(row.labelAvailableAt) > time(asOf)) throw new Error('OOS_PIT_VIOLATION');
    if ([row.prediction, row.baselinePrediction, row.outcome].some((v) => !Number.isFinite(v)) ||
      (binary && (row.outcome !== 0 && row.outcome !== 1 || [row.prediction, row.baselinePrediction].some((v) => v < 0 || v > 1)))) throw new Error('OOS_VALUES_INVALID');
    modelLoss += loss(row.prediction, row.outcome);
    baselineLoss += loss(row.baselinePrediction, row.outcome);
  }
  modelLoss /= evidence.rows.length;
  baselineLoss /= evidence.rows.length;
  if (!Number.isFinite(modelLoss) || !Number.isFinite(baselineLoss)) throw new Error('OOS_LOSS_OVERFLOW');
  return { supported: evidence.rows.length >= evidence.minimumPairedRows && baselineLoss - modelLoss > evidence.minimumLossImprovement,
    pairedN: evidence.rows.length, modelLoss, baselineLoss, metric: binary ? 'BRIER' : quantile === undefined ? 'SQUARED_ERROR' : 'PINBALL_LOSS' };
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
  /** This research comparison never certifies empirical provenance or promotion. */
  readonly promotionEligible: false;
  readonly comparison: ReturnType<typeof evaluateEntryOosComparison> | null;
  readonly evidenceScope: 'RESEARCH_INPUT_VALIDATION_NOT_EMPIRICAL_PROVENANCE_CERTIFICATION';
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
  readonly oosComparison?: EntryOosComparison;
}): EntryModelReadinessAssessment {
  if (!Number.isFinite(Date.parse(input.asOf))) throw new Error('INVALID_ASOF');
  if (!entryModelFamilies.includes(input.modelFamily) || !entryModelTargets.includes(input.target)) throw new Error('MODEL_FAMILY_OR_TARGET_INVALID');
  if ((input.modelFamily === 'QUANTILE_DOWNSIDE' && !input.target.startsWith('DOWNSIDE_')) ||
    (input.modelFamily === 'REGULARIZED_LOGISTIC' && !input.target.startsWith('P_'))) throw new Error('MODEL_FAMILY_TARGET_INCOMPATIBLE');
  const s = input.sufficiency;
  const scope = { evidenceScope: 'RESEARCH_INPUT_VALIDATION_NOT_EMPIRICAL_PROVENANCE_CERTIFICATION' as const, comparison: null };
  for (const [name, value] of [
    ['rawRowCount', s.rawRowCount], ['resolvedLabelRowCount', s.resolvedLabelRowCount], ['censoredRowCount', s.censoredRowCount],
    ['effectiveIndependentN', s.effectiveIndependentN], ['minimumEffectiveN', s.minimumEffectiveN],
    ['distinctUnderlyingCount', s.distinctUnderlyingCount], ['minimumDistinctUnderlyings', s.minimumDistinctUnderlyings],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_SUFFICIENCY_FIELD:${name}`);
  }
  if (s.resolvedLabelRowCount + s.censoredRowCount > s.rawRowCount) throw new Error('SUFFICIENCY_COUNTS_INCONSISTENT');
  if (s.minimumEffectiveN < 1 || s.minimumDistinctUnderlyings < 1) throw new Error('POSITIVE_SUFFICIENCY_POLICY_REQUIRED');
  if (s.effectiveIndependentN > s.resolvedLabelRowCount || s.distinctUnderlyingCount > s.rawRowCount) throw new Error('SUFFICIENCY_COUNTS_INCONSISTENT');

  if (s.rawRowCount === 0) {
    return {
      ...scope, contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'DATASET_NOT_READY', reason: 'Zero raw rows -- dataset does not exist yet.', sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  const insufficientN = s.effectiveIndependentN < s.minimumEffectiveN || s.distinctUnderlyingCount < s.minimumDistinctUnderlyings;
  if (insufficientN) {
    if (input.evaluation !== undefined) throw new Error('EVALUATION_SUPPLIED_DESPITE_INSUFFICIENT_N');
    return {
      ...scope, contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'INSUFFICIENT_EFFECTIVE_N',
      reason: `effectiveIndependentN=${s.effectiveIndependentN} (min ${s.minimumEffectiveN}) or distinctUnderlyingCount=${s.distinctUnderlyingCount} (min ${s.minimumDistinctUnderlyings}) below policy minimum.`,
      sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  if (input.evaluation === undefined) {
    return {
      ...scope, contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'TRAINING_READY', reason: 'Sufficiency minimums met; no evaluation supplied yet.', sufficiency: s, evaluation: null, promotionEligible: false,
    };
  }
  if (input.evaluation.effectiveIndependentN !== s.effectiveIndependentN) throw new Error('EVALUATION_N_MISMATCH');
  if (Object.values(input.evaluation).some((value) => value !== null && !Number.isFinite(value))) throw new Error('EVALUATION_METRIC_NONFINITE');
  const calibrationOk = !input.target.startsWith('P_') || input.evaluation.calibrationSlope !== null && input.evaluation.calibrationIntercept !== null
    && Math.abs(input.evaluation.calibrationSlope - 1) < 0.25 && Math.abs(input.evaluation.calibrationIntercept) < 0.1;
  if (!calibrationOk) {
    return {
      ...scope, contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'CALIBRATION_FAILED', reason: 'Calibration slope/intercept outside real acceptance bounds, or not supplied.',
      sufficiency: s, evaluation: input.evaluation, promotionEligible: false,
    };
  }
  if (input.oosComparison === undefined) {
    return {
      ...scope, contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
      state: 'TRAINED', reason: 'Evaluation supplied. Caller OOS flags are not evidence; paired held-out rows are required.', sufficiency: s, evaluation: input.evaluation, promotionEligible: false,
    };
  }
  const comparison = evaluateEntryOosComparison(input.target, input.oosComparison, input.asOf);
  return {
    ...scope, comparison,
    contractVersion: thetaEntryModelReadinessVersion, modelFamily: input.modelFamily, target: input.target, asOf: input.asOf,
    state: comparison.supported ? 'OOS_SUPPORTED' : 'OOS_FAILED', reason: 'Paired held-out predictive loss comparison executed. Dataset provenance and promotion require separate canonical evidence review.',
    sufficiency: s, evaluation: input.evaluation, promotionEligible: false,
  };
}
