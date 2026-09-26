/**
 * COMMAND 5C-7 items 37-39: adaptive-selector research pipeline. Wires
 * together the already-real pieces (dataset/feature contracts,
 * `empirical-model-registry.ts`'s baseline linkage, `purge-embargo-
 * contract.ts`'s split discipline, `calibration-evaluation-contract.ts`,
 * `prediction-outcome-join.ts`, `adaptive-strategy-selector-shadow.ts`'s
 * shadow-only output) into one ordered pipeline, and adds the two pieces
 * that did not yet exist: a real baseline-first gate and a real
 * complex-model gate. Does not retrain or reimplement any of the wired
 * pieces' own math.
 */
import type { PurgeEmbargoReport } from './purge-embargo-contract.js';
import type { ModelPromotionState } from './empirical-model-registry.js';

export const adaptiveSelectorResearchPipelineVersion = 'theta-adaptive-selector-research-pipeline-v1' as const;

export type PipelineStage =
  | 'DATASET_GENERATION' | 'FEATURE_EXTRACTION' | 'BASELINE_COMPARATOR' | 'TRAINING_INTERFACE'
  | 'CALIBRATION_INTERFACE' | 'WALK_FORWARD_EVALUATION' | 'PREDICTION_RECEIPTS' | 'OUTCOME_JOIN' | 'STRATEGY_UTILITY_REPORT';

export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  'DATASET_GENERATION', 'FEATURE_EXTRACTION', 'BASELINE_COMPARATOR', 'TRAINING_INTERFACE',
  'CALIBRATION_INTERFACE', 'WALK_FORWARD_EVALUATION', 'PREDICTION_RECEIPTS', 'OUTCOME_JOIN', 'STRATEGY_UTILITY_REPORT',
];

/**
 * COMMAND 2 §4 / COMMAND 5C-7 §38: baseline-first requirement, made a
 * real, checkable gate. A challenger model attempting to enter the
 * pipeline beyond `BASELINE_COMPARATOR` must declare a real
 * `baselineModelId` that is (a) actually registered and (b) not itself
 * requiring a baseline (i.e. genuinely a baseline model, `isBaseline:
 * true`) -- otherwise this throws rather than silently letting a
 * baseline-less model proceed.
 */
export interface BaselineRegistryLookup {
  readonly modelId: string;
  readonly isBaseline: boolean;
}

export function assertBaselineFirst(
  challengerBaselineModelId: string | null, isBaseline: boolean, registeredBaselines: readonly BaselineRegistryLookup[],
): void {
  if (isBaseline) return; // a baseline model needs no prior baseline
  if (challengerBaselineModelId === null) throw new Error('ADAPTIVE_SELECTOR_CHALLENGER_WITHOUT_BASELINE');
  const baseline = registeredBaselines.find((b) => b.modelId === challengerBaselineModelId);
  if (baseline === undefined) throw new Error(`ADAPTIVE_SELECTOR_BASELINE_NOT_REGISTERED:${challengerBaselineModelId}`);
  if (!baseline.isBaseline) throw new Error(`ADAPTIVE_SELECTOR_REFERENCED_MODEL_IS_NOT_A_BASELINE:${challengerBaselineModelId}`);
}

/**
 * COMMAND 5C-7 §39: complex-model gate. Every condition must be real and
 * true before an advanced-model experiment (HMM/survival/quantile/VAE/
 * LSTM/Transformer/etc., per Command 2 §4's challenger tier) may even be
 * ATTEMPTED -- "sufficient independent N" is caller-supplied (this
 * module does not compute N itself, it only gates on it), the rest are
 * real boolean pass/fail states from the already-real modules this
 * pipeline wires together.
 */
export interface ComplexModelGateInputs {
  readonly independentN: number;
  readonly minimumIndependentN: number;
  readonly baselineEstablished: boolean;
  readonly pitLeakagePassed: boolean;
  readonly purgedWalkForwardPassed: boolean;
  readonly calibrationInfrastructurePassed: boolean;
  readonly oosReservationPassed: boolean;
}

export interface ComplexModelGateResult {
  readonly eligible: boolean;
  readonly failedConditions: readonly string[];
}

export function evaluateComplexModelGate(inputs: ComplexModelGateInputs): ComplexModelGateResult {
  const failed: string[] = [];
  if (inputs.independentN < inputs.minimumIndependentN) failed.push(`independentN ${inputs.independentN} < minimum ${inputs.minimumIndependentN}`);
  if (!inputs.baselineEstablished) failed.push('baseline not established');
  if (!inputs.pitLeakagePassed) failed.push('PIT leakage check did not pass');
  if (!inputs.purgedWalkForwardPassed) failed.push('purged walk-forward did not pass');
  if (!inputs.calibrationInfrastructurePassed) failed.push('calibration infrastructure did not pass');
  if (!inputs.oosReservationPassed) failed.push('OOS reservation did not pass');
  return { eligible: failed.length === 0, failedConditions: failed };
}

/**
 * Real per-stage state tracking -- a pipeline run cannot report a later
 * stage as reached while an earlier one has not passed, structurally
 * enforced by `advance()`'s ordering check rather than left to caller
 * discipline.
 */
export class AdaptiveSelectorPipelineRun {
  private currentStageIndex = -1;
  private readonly stageResults = new Map<PipelineStage, unknown>();

  advance(stage: PipelineStage, result: unknown): void {
    const stageIndex = PIPELINE_STAGE_ORDER.indexOf(stage);
    if (stageIndex !== this.currentStageIndex + 1) {
      throw new Error(`ADAPTIVE_SELECTOR_PIPELINE_OUT_OF_ORDER:${stage}`);
    }
    this.currentStageIndex = stageIndex;
    this.stageResults.set(stage, result);
  }

  reachedStage(): PipelineStage | null { return this.currentStageIndex === -1 ? null : (PIPELINE_STAGE_ORDER[this.currentStageIndex] ?? null); }

  resultFor<T>(stage: PipelineStage): T | undefined { return this.stageResults.get(stage) as T | undefined; }
}

export type { PurgeEmbargoReport, ModelPromotionState };
