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

/**
 * COMMAND 5C-7 closure item 2: real calibration-metric computation for
 * this wave's new probability-shaped outputs (`execution-fill-
 * baseline.ts`'s fill-probability predictions, and any future TS-side
 * baseline's predicted-probability output) -- fills this contract's
 * existing Brier/log-loss/ECE/slope/intercept/reliability-bins fields
 * from real (predictedProbability, observedOutcome) pairs, rather than
 * requiring every caller to compute these independently. Does NOT
 * reimplement `validation.py`'s Platt/isotonic FITTING machinery -- this
 * is evaluation-side scoring of already-produced predictions, a distinct
 * and legitimate computation appropriate for TS-side baseline models.
 */
export interface CalibrationEvaluationPair {
  readonly rowId: string;
  readonly predictedProbability: number;
  readonly observedOutcome: 0 | 1;
}

function clampProbability(p: number): number {
  return Math.min(1 - 1e-12, Math.max(1e-12, p));
}

export function computeBrierScore(pairs: readonly CalibrationEvaluationPair[]): number | null {
  if (pairs.length === 0) return null;
  const sum = pairs.reduce((acc, p) => acc + (p.predictedProbability - p.observedOutcome) ** 2, 0);
  return sum / pairs.length;
}

export function computeLogLoss(pairs: readonly CalibrationEvaluationPair[]): number | null {
  if (pairs.length === 0) return null;
  const sum = pairs.reduce((acc, p) => {
    const clamped = clampProbability(p.predictedProbability);
    return acc + (p.observedOutcome === 1 ? -Math.log(clamped) : -Math.log(1 - clamped));
  }, 0);
  return sum / pairs.length;
}

/** Equal-width bins over [0,1] -- real per-bin mean predicted/observed
 * values and counts, never a fabricated bin for an empty range (empty
 * bins are simply omitted, not reported with a fake n=0 row). */
export function computeReliabilityBins(pairs: readonly CalibrationEvaluationPair[], binCount = 10): readonly ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < binCount; i += 1) {
    const lower = i / binCount;
    const upper = (i + 1) / binCount;
    const members = pairs.filter((p) => p.predictedProbability >= lower && (i === binCount - 1 ? p.predictedProbability <= upper : p.predictedProbability < upper));
    if (members.length === 0) continue;
    bins.push({
      binLower: lower, binUpper: upper,
      meanPredicted: members.reduce((a, p) => a + p.predictedProbability, 0) / members.length,
      meanObserved: members.reduce((a, p) => a + p.observedOutcome, 0) / members.length,
      n: members.length,
    });
  }
  return bins;
}

/** ECE = sum over bins of (n_bin / N) * |meanObserved - meanPredicted| --
 * the standard weighted-average calibration-gap definition. `null` when
 * no bins have any members. */
export function computeEce(bins: readonly ReliabilityBin[], totalN: number): number | null {
  if (bins.length === 0 || totalN === 0) return null;
  return bins.reduce((acc, bin) => acc + (bin.n / totalN) * Math.abs(bin.meanObserved - bin.meanPredicted), 0);
}

/**
 * Real calibration slope/intercept via ordinary least squares of
 * observed outcome on predicted probability (`observed = intercept +
 * slope * predicted`) -- the simple, standard linear calibration-curve
 * convention (slope=1, intercept=0 is perfect calibration). `null` when
 * fewer than 2 points or the predicted values have zero variance (no
 * fabricated regression line).
 */
export function computeCalibrationSlopeIntercept(pairs: readonly CalibrationEvaluationPair[]): { readonly slope: number | null; readonly intercept: number | null } {
  const n = pairs.length;
  if (n < 2) return { slope: null, intercept: null };
  const meanX = pairs.reduce((a, p) => a + p.predictedProbability, 0) / n;
  const meanY = pairs.reduce((a, p) => a + p.observedOutcome, 0) / n;
  const varianceX = pairs.reduce((a, p) => a + (p.predictedProbability - meanX) ** 2, 0);
  if (varianceX === 0) return { slope: null, intercept: null };
  const covarianceXY = pairs.reduce((a, p) => a + (p.predictedProbability - meanX) * (p.observedOutcome - meanY), 0);
  const slope = covarianceXY / varianceX;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/**
 * The real end-to-end wiring: computes every metric from raw prediction/
 * outcome pairs and builds a full `CalibrationEvaluationReceipt` via the
 * existing `buildCalibrationReceipt` -- never bypasses its fitting/
 * evaluation-overlap check. Returns `null` (never a fabricated receipt)
 * when the real computations cannot support one (e.g. zero-variance
 * predictions).
 */
export function evaluateCalibrationFromPredictions(input: {
  readonly modelId: string; readonly modelVersion: string; readonly dataProvenance: CalibrationDataProvenance;
  readonly evaluationPairs: readonly CalibrationEvaluationPair[]; readonly fittingRowIds: readonly string[];
  readonly independentN: number;
}): CalibrationEvaluationReceipt | null {
  const brierScore = computeBrierScore(input.evaluationPairs);
  const logLoss = computeLogLoss(input.evaluationPairs);
  const bins = computeReliabilityBins(input.evaluationPairs);
  const ece = computeEce(bins, input.evaluationPairs.length);
  const { slope, intercept } = computeCalibrationSlopeIntercept(input.evaluationPairs);
  if (brierScore === null || logLoss === null || ece === null || slope === null || intercept === null) return null;
  return buildCalibrationReceipt({
    modelId: input.modelId, modelVersion: input.modelVersion, dataProvenance: input.dataProvenance,
    evaluationRowIds: input.evaluationPairs.map((p) => p.rowId), fittingRowIds: input.fittingRowIds,
    brierScore, logLoss, ece, calibrationSlope: slope, calibrationIntercept: intercept,
    reliabilityBins: bins, independentN: input.independentN, confidenceIntervalWidth95: null,
  });
}
