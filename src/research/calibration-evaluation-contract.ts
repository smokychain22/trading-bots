/**
 * COMMAND 4 item 17 (COMMAND 2 §16/§26, COMMAND 3 §17/§26). TS-side
 * calibration-evaluation receipt. Research-only, `brokerAuthority: false`.
 * Wraps `validation.py`'s real Platt/isotonic calibration machinery
 * (Python, quant-owned, not reimplemented here) -- this module is a typed
 * output contract, not a reimplementation of the calibration math.
 *
 * Any fixture/synthetic evaluation input MUST be tagged
 * `NON_EMPIRICAL_TEST_DATA` in the resulting receipt -- `buildCalibrationReceipt`
 * requires the caller to state this explicitly (`dataProvenance`), never
 * defaults to empirical.
 */

export const calibrationEvaluationContractVersion = 'theta-calibration-evaluation-contract-v1' as const;

export type CalibrationDataProvenance = 'REAL_EMPIRICAL_DATA' | 'NON_EMPIRICAL_TEST_DATA';

export interface ReliabilityBin {
  readonly binLower: number;
  readonly binUpper: number;
  readonly meanPredicted: number;
  readonly meanObserved: number;
  readonly n: number;
}

export interface CalibrationEvaluationReceipt {
  readonly contractVersion: typeof calibrationEvaluationContractVersion;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dataProvenance: CalibrationDataProvenance;
  readonly brierScore: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly calibrationSlope: number;
  readonly calibrationIntercept: number;
  readonly reliabilityBins: readonly ReliabilityBin[];
  readonly n: number;
  readonly independentN: number;
  readonly confidenceIntervalWidth95: number | null;
}

/**
 * `evaluationRows` must be disjoint from `fittingRowIds` -- calibration must
 * never be evaluated on the same sample used to fit the calibrator. Throws
 * if any overlap is detected.
 */
export function buildCalibrationReceipt(input: {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dataProvenance: CalibrationDataProvenance;
  readonly evaluationRowIds: readonly string[];
  readonly fittingRowIds: readonly string[];
  readonly brierScore: number;
  readonly logLoss: number;
  readonly ece: number;
  readonly calibrationSlope: number;
  readonly calibrationIntercept: number;
  readonly reliabilityBins: readonly ReliabilityBin[];
  readonly independentN: number;
  readonly confidenceIntervalWidth95: number | null;
}): CalibrationEvaluationReceipt {
  const fittingSet = new Set(input.fittingRowIds);
  if (input.evaluationRowIds.some((id) => fittingSet.has(id))) throw new Error('CALIBRATION_EVALUATION_OVERLAPS_FITTING_SAMPLE');
  return {
    contractVersion: calibrationEvaluationContractVersion, modelId: input.modelId, modelVersion: input.modelVersion,
    dataProvenance: input.dataProvenance, brierScore: input.brierScore, logLoss: input.logLoss, ece: input.ece,
    calibrationSlope: input.calibrationSlope, calibrationIntercept: input.calibrationIntercept,
    reliabilityBins: input.reliabilityBins, n: input.evaluationRowIds.length, independentN: input.independentN,
    confidenceIntervalWidth95: input.confidenceIntervalWidth95,
  };
}

/** A `NON_EMPIRICAL_TEST_DATA` receipt is structurally ineligible for
 * promotion evidence -- callers must check this before ever citing a
 * calibration receipt in a promotion decision. */
export function isEligibleForPromotionEvidence(receipt: CalibrationEvaluationReceipt): boolean {
  return receipt.dataProvenance === 'REAL_EMPIRICAL_DATA';
}
