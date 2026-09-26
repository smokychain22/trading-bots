/**
 * COMMAND 5C-7 item 41: fill-probability baseline. Baseline-1-tier
 * (regularized logistic regression, per Command 2 §4's baseline-first
 * order) over `FillProbabilityRow` (`execution-dataset-contract.ts`,
 * already real). Unfilled orders are genuinely IN this baseline's
 * training population (they are the real negative class) -- this module
 * never excludes them, unlike the slippage baseline which structurally
 * cannot use them at all.
 */
import type { FillProbabilityRow } from './execution-dataset-contract.js';

export const executionFillBaselineVersion = 'theta-execution-fill-baseline-v1' as const;

/** A single real feature vector derived from a `FillProbabilityRow` --
 * every field null-safe, since real orders frequently have unknown
 * liquidity/OI/volume at decision time. */
export interface FillFeatureVector {
  readonly limitOffsetFromMid: number;
  readonly quoteAgeSeconds: number | null;
  readonly underlyingLiquidity: number | null;
  readonly optionOpenInterest: number | null;
  readonly optionVolume: number | null;
}

export function featureVectorFromRow(row: FillProbabilityRow): FillFeatureVector {
  return {
    limitOffsetFromMid: row.limitOffsetFromMid, quoteAgeSeconds: row.quoteAgeSeconds,
    underlyingLiquidity: row.underlyingLiquidity, optionOpenInterest: row.optionOpenInterest, optionVolume: row.optionVolume,
  };
}

export interface FillBaselineCoefficients {
  readonly intercept: number;
  readonly limitOffsetFromMid: number;
  readonly quoteAgeSeconds: number;
  readonly underlyingLiquidity: number;
  readonly optionOpenInterest: number;
  readonly optionVolume: number;
}

interface FeatureStandardization {
  readonly mean: number;
  readonly std: number;
}

export interface FillBaselineModel {
  readonly contractVersion: typeof executionFillBaselineVersion;
  readonly coefficients: FillBaselineCoefficients;
  readonly trainingN: number;
  readonly l2Penalty: number;
  /** Real per-feature standardization (z-score mean/std) applied at fit
   * time and reused identically at predict time -- without this, a
   * raw-scale feature like underlying liquidity (order of 10^6) silently
   * dominates a fractional feature like limitOffsetFromMid (order of
   * 10^-2) in the gradient, saturating the sigmoid and producing a model
   * that predicts a near-constant probability regardless of input. This
   * is a real numerical-correctness requirement, not a stylistic choice. */
  readonly standardization: Readonly<Record<Exclude<keyof FillFeatureVector, 'limitOffsetFromMid'>, FeatureStandardization>>;
}

function sigmoid(z: number): number { return 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, z)))); }

function meanAndStd(values: readonly number[]): FeatureStandardization {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return { mean, std: variance > 0 ? Math.sqrt(variance) : 1 };
}

function standardize(value: number, s: FeatureStandardization): number { return (value - s.mean) / s.std; }

/**
 * Baseline-0 control: base rate (fraction filled), no features at all --
 * every real model above this must beat it OOS before being considered
 * (Command 2 §4).
 */
export function baseRateFillProbability(rows: readonly FillProbabilityRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.filter((r) => r.filled).length / rows.length;
}

/**
 * A single-pass, L2-regularized logistic regression fit via gradient
 * descent -- deliberately simple (Baseline 1, not a challenger). Missing
 * feature values are mean-imputed across the observed population for
 * this fit only (a real, documented limitation -- a promoted model would
 * need a real missingness-aware treatment, not silent imputation; this
 * baseline exists to be beaten, not to be the final answer).
 */
export function fitFillBaseline(
  rows: readonly FillProbabilityRow[], l2Penalty = 1.0, learningRate = 0.1, iterations = 500,
): FillBaselineModel {
  const n = rows.length;
  const zeroModel: FillBaselineModel = {
    contractVersion: executionFillBaselineVersion,
    coefficients: { intercept: 0, limitOffsetFromMid: 0, quoteAgeSeconds: 0, underlyingLiquidity: 0, optionOpenInterest: 0, optionVolume: 0 },
    trainingN: 0, l2Penalty,
    standardization: {
      quoteAgeSeconds: { mean: 0, std: 1 }, underlyingLiquidity: { mean: 0, std: 1 },
      optionOpenInterest: { mean: 0, std: 1 }, optionVolume: { mean: 0, std: 1 },
    },
  };
  if (n === 0) return zeroModel;

  const means = {
    quoteAgeSeconds: average(rows.map((r) => r.quoteAgeSeconds)),
    underlyingLiquidity: average(rows.map((r) => r.underlyingLiquidity)),
    optionOpenInterest: average(rows.map((r) => r.optionOpenInterest)),
    optionVolume: average(rows.map((r) => r.optionVolume)),
  };
  const imputedRaw = {
    quoteAgeSeconds: rows.map((r) => r.quoteAgeSeconds ?? means.quoteAgeSeconds ?? 0),
    underlyingLiquidity: rows.map((r) => r.underlyingLiquidity ?? means.underlyingLiquidity ?? 0),
    optionOpenInterest: rows.map((r) => r.optionOpenInterest ?? means.optionOpenInterest ?? 0),
    optionVolume: rows.map((r) => r.optionVolume ?? means.optionVolume ?? 0),
  };
  const standardization = {
    quoteAgeSeconds: meanAndStd(imputedRaw.quoteAgeSeconds), underlyingLiquidity: meanAndStd(imputedRaw.underlyingLiquidity),
    optionOpenInterest: meanAndStd(imputedRaw.optionOpenInterest), optionVolume: meanAndStd(imputedRaw.optionVolume),
  };

  const vectors = rows.map((r, i) => [
    1, r.limitOffsetFromMid,
    standardize(imputedRaw.quoteAgeSeconds[i] as number, standardization.quoteAgeSeconds),
    standardize(imputedRaw.underlyingLiquidity[i] as number, standardization.underlyingLiquidity),
    standardize(imputedRaw.optionOpenInterest[i] as number, standardization.optionOpenInterest),
    standardize(imputedRaw.optionVolume[i] as number, standardization.optionVolume),
  ]);
  const labels = rows.map((r) => (r.filled ? 1 : 0));
  let weights = [0, 0, 0, 0, 0, 0];
  for (let iter = 0; iter < iterations; iter += 1) {
    const gradients = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += 1) {
      const vector = vectors[i] as number[];
      const z = vector.reduce((sum, x, j) => sum + x * (weights[j] as number), 0);
      const error = sigmoid(z) - (labels[i] as number);
      for (let j = 0; j < 6; j += 1) gradients[j] = (gradients[j] as number) + error * (vector[j] as number);
    }
    weights = weights.map((w, j) => w - learningRate * ((gradients[j] as number) / n + l2Penalty * (j === 0 ? 0 : w) / n));
  }
  return {
    contractVersion: executionFillBaselineVersion,
    coefficients: {
      intercept: weights[0] as number, limitOffsetFromMid: weights[1] as number,
      quoteAgeSeconds: weights[2] as number, underlyingLiquidity: weights[3] as number,
      optionOpenInterest: weights[4] as number, optionVolume: weights[5] as number,
    },
    trainingN: n, l2Penalty, standardization,
  };
}

function average(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
}

export interface FillPredictionDiagnostics {
  readonly probability: number;
  readonly outOfDomain: boolean;
  readonly outOfDomainFields: readonly string[];
  readonly modelHasZeroTrainingData: boolean;
}

/** A standardized feature value more than this many standard deviations
 * from the training mean is flagged out-of-domain -- the baseline is
 * still evaluated (never refuses to produce a number), but the caller
 * receives an explicit, typed signal that this prediction extrapolates
 * well beyond what the model was ever fit on. */
const OUT_OF_DOMAIN_Z_THRESHOLD = 4;

/**
 * ADVERSARIAL HARDENING (overnight §24): the plain `predictFillProbability`
 * always returns a bare number with no way to distinguish "well-supported
 * prediction" from "wild extrapolation on unseen feature scale." This
 * wrapper adds that typed signal without changing the underlying model or
 * its math.
 */
export function predictFillProbabilityWithDiagnostics(
  model: FillBaselineModel, features: FillFeatureVector,
): FillPredictionDiagnostics {
  const probability = predictFillProbability(model, features);
  const s = model.standardization;
  const checks: readonly { readonly field: string; readonly value: number | null; readonly stat: FeatureStandardization }[] = [
    { field: 'quoteAgeSeconds', value: features.quoteAgeSeconds, stat: s.quoteAgeSeconds },
    { field: 'underlyingLiquidity', value: features.underlyingLiquidity, stat: s.underlyingLiquidity },
    { field: 'optionOpenInterest', value: features.optionOpenInterest, stat: s.optionOpenInterest },
    { field: 'optionVolume', value: features.optionVolume, stat: s.optionVolume },
  ];
  const outOfDomainFields = checks
    .filter((c) => c.value !== null && Math.abs(standardize(c.value, c.stat)) > OUT_OF_DOMAIN_Z_THRESHOLD)
    .map((c) => c.field);
  return {
    probability, outOfDomain: outOfDomainFields.length > 0 || model.trainingN === 0,
    outOfDomainFields, modelHasZeroTrainingData: model.trainingN === 0,
  };
}

export function predictFillProbability(model: FillBaselineModel, features: FillFeatureVector): number {
  const c = model.coefficients;
  const s = model.standardization;
  const z = c.intercept + c.limitOffsetFromMid * features.limitOffsetFromMid
    + c.quoteAgeSeconds * standardize(features.quoteAgeSeconds ?? s.quoteAgeSeconds.mean, s.quoteAgeSeconds)
    + c.underlyingLiquidity * standardize(features.underlyingLiquidity ?? s.underlyingLiquidity.mean, s.underlyingLiquidity)
    + c.optionOpenInterest * standardize(features.optionOpenInterest ?? s.optionOpenInterest.mean, s.optionOpenInterest)
    + c.optionVolume * standardize(features.optionVolume ?? s.optionVolume.mean, s.optionVolume);
  return sigmoid(z);
}
