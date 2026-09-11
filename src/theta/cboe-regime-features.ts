// Derived research features over CboeRegimeSnapshot observations -- pure,
// network-free, no probability model, no hardcoded trade rule. Every
// function returns null (UNKNOWN) when its required raw input is missing,
// never a fabricated 0/default. Percentile/z-score functions are STRICTLY
// point-in-time safe: they only ever consider historical observations
// timestamped at or before `asOfUtc`, never a later value -- see the
// "NO FUTURE LEAKAGE" tests in cboe-regime-features.test.ts, which mirror
// underlying-features.ts's own no-lookahead discipline.
//
// This module does NOT classify a trade decision. classifyCboeRegime
// below is explicitly a RESEARCH utility: the state boundaries it uses
// are versioned POLICY the caller supplies, never a default asserted as
// validated production truth (per this session's explicit instruction:
// "thresholds must be learned/tested empirically rather than guessed").

export interface CboeHistoricalObservation {
  readonly asOfUtc: string;
  readonly value: number;
}

/** NearTermVolRatio = VIX9D / VIX -- UNKNOWN if either input is missing or VIX is 0. */
export function computeNearTermVolRatio(vix9d: number | null, vix: number | null): number | null {
  if (vix9d === null || vix === null || vix === 0) return null;
  return vix9d / vix;
}

function priorObservations(series: readonly CboeHistoricalObservation[], asOfUtc: string): readonly CboeHistoricalObservation[] {
  const asOfMs = new Date(asOfUtc).getTime();
  return series.filter((o) => new Date(o.asOfUtc).getTime() <= asOfMs);
}

/**
 * Percentile rank (0-1) of `currentValue` within the historical series as
 * of `asOfUtc` -- fraction of PRIOR observations at or below the current
 * value. UNKNOWN if currentValue is null or there is no prior history at
 * all. Point-in-time safe: any series entry timestamped AFTER asOfUtc is
 * excluded before any computation happens.
 */
export function computePercentile(series: readonly CboeHistoricalObservation[], asOfUtc: string, currentValue: number | null): number | null {
  if (currentValue === null) return null;
  const prior = priorObservations(series, asOfUtc);
  if (prior.length === 0) return null;
  const countBelowOrEqual = prior.filter((o) => o.value <= currentValue).length;
  return countBelowOrEqual / prior.length;
}

/**
 * Z-score of `currentValue` against the historical series's mean/stddev
 * as of `asOfUtc`. UNKNOWN if currentValue is null, fewer than 2 prior
 * observations exist (stddev undefined), or the historical stddev is
 * exactly 0 (a z-score against zero variance is undefined, never
 * fabricated as +/-Infinity or 0). Point-in-time safe, same as
 * computePercentile.
 */
export function computeZScore(series: readonly CboeHistoricalObservation[], asOfUtc: string, currentValue: number | null): number | null {
  if (currentValue === null) return null;
  const prior = priorObservations(series, asOfUtc);
  if (prior.length < 2) return null;
  const mean = prior.reduce((sum, o) => sum + o.value, 0) / prior.length;
  const variance = prior.reduce((sum, o) => sum + (o.value - mean) ** 2, 0) / prior.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return (currentValue - mean) / stddev;
}

// ---------------------------------------------------------------------------
// Research-only regime classification -- NEVER wired into any production
// decision path in this commit. Thresholds are caller-supplied POLICY,
// not a hardcoded default asserted as validated. Do not use this to gate
// a trade; it exists to be compared against realized outcomes in later
// empirical/OOS work.
// ---------------------------------------------------------------------------

export type CboeRegimeState = 'LOW_STRESS' | 'NORMAL' | 'ELEVATED' | 'HIGH_STRESS' | 'UNKNOWN';

export interface CboeRegimeClassificationPolicy {
  readonly policyVersion: string;
  readonly lowStressVixPercentileCeiling: number; // vixPercentile at or below this -> LOW_STRESS
  readonly elevatedVixPercentileFloor: number; // vixPercentile at or above this -> ELEVATED (unless HIGH_STRESS)
  readonly highStressVixPercentileFloor: number; // vixPercentile at or above this -> HIGH_STRESS
}

/**
 * Classifies a regime state from a VIX percentile ONLY when the caller
 * supplies a policy -- this function invents no default thresholds of its
 * own (see module docstring). UNKNOWN when vixPercentile is null, never a
 * default state.
 */
export function classifyCboeRegime(vixPercentile: number | null, policy: CboeRegimeClassificationPolicy): CboeRegimeState {
  if (vixPercentile === null) return 'UNKNOWN';
  if (vixPercentile >= policy.highStressVixPercentileFloor) return 'HIGH_STRESS';
  if (vixPercentile >= policy.elevatedVixPercentileFloor) return 'ELEVATED';
  if (vixPercentile <= policy.lowStressVixPercentileCeiling) return 'LOW_STRESS';
  return 'NORMAL';
}
