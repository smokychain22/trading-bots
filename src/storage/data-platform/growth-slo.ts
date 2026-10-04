// Storage SLOs: the POST-ARCHIVE database size must stay inside a bounded steady-state band. A post-archive size that keeps rising with session count is an INCIDENT
// (UNBOUNDED_POSTGRES_GROWTH) long before the provider limit. Robust statistics (Theil-Sen slope, Mann-Kendall tau) so one extreme session cannot trip or hide it.
import { incident, type PlatformIncident } from './incidents.js';

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : (((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
};

/** Theil-Sen slope: the median of all pairwise slopes. Unbiased by a few outlier sessions. */
export function theilSenSlope(series: readonly number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < series.length; i += 1) for (let j = i + 1; j < series.length; j += 1) slopes.push(((series[j] ?? 0) - (series[i] ?? 0)) / (j - i));
  return median(slopes);
}

/** Mann-Kendall tau in [-1, 1]: +1 means strictly increasing. */
export function kendallTau(series: readonly number[]): number {
  let concordant = 0, discordant = 0;
  for (let i = 0; i < series.length; i += 1) for (let j = i + 1; j < series.length; j += 1) {
    const diff = (series[j] ?? 0) - (series[i] ?? 0);
    if (diff > 0) concordant += 1; else if (diff < 0) discordant += 1;
  }
  const pairs = (series.length * (series.length - 1)) / 2;
  return pairs === 0 ? 0 : (concordant - discordant) / pairs;
}

export interface SteadyStateAssessment {
  readonly sessions: number;
  readonly slopeBytesPerSession: number;
  readonly tau: number;
  readonly meanBytes: number;
  readonly bandLowBytes: number;
  readonly bandHighBytes: number;
  readonly linearGrowthDetected: boolean;
  readonly state: 'INSUFFICIENT_HISTORY' | 'STEADY' | 'LINEAR_GROWTH';
}

export interface SteadyStatePolicy {
  /** minimum sessions of post-archive history before a verdict */
  readonly minSessions: number;
  /** tolerated slope as a fraction of the mean per session (e.g. 0.002 = 0.2% of the mean) */
  readonly maxRelativeSlopePerSession: number;
  /** a clearly monotone series (tau above this) with a positive slope above the tolerance is linear growth */
  readonly tauThreshold: number;
}

export const defaultSteadyStatePolicy: SteadyStatePolicy = { minSessions: 20, maxRelativeSlopePerSession: 0.002, tauThreshold: 0.5 };

export function assessSteadyState(postArchiveBytes: readonly number[], policy: SteadyStatePolicy = defaultSteadyStatePolicy): SteadyStateAssessment {
  const n = postArchiveBytes.length;
  const mean = n === 0 ? 0 : postArchiveBytes.reduce((a, b) => a + b, 0) / n;
  const slope = theilSenSlope(postArchiveBytes);
  const tau = kendallTau(postArchiveBytes);
  const deviation = n === 0 ? 0 : Math.sqrt(postArchiveBytes.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const growing = n >= policy.minSessions && tau >= policy.tauThreshold && slope > policy.maxRelativeSlopePerSession * mean;
  return { sessions: n, slopeBytesPerSession: slope, tau, meanBytes: mean, bandLowBytes: mean - 2 * deviation, bandHighBytes: mean + 2 * deviation, linearGrowthDetected: growing,
    state: n < policy.minSessions ? 'INSUFFICIENT_HISTORY' : growing ? 'LINEAR_GROWTH' : 'STEADY' };
}

export function growthIncident(assessment: SteadyStateAssessment, observedAt: string): PlatformIncident | null {
  return assessment.linearGrowthDetected
    ? incident('UNBOUNDED_POSTGRES_GROWTH', 'CRITICAL', {}, `post-archive size rising ${Math.round(assessment.slopeBytesPerSession)} bytes/session (tau ${assessment.tau.toFixed(2)}) over ${assessment.sessions} sessions`, observedAt) : null;
}

export interface HotBytesSample { readonly decisionBytes: readonly number[] }
export const hotBytesPercentile = (bytes: readonly number[], p: number): number => {
  if (bytes.length === 0) return 0;
  const sorted = [...bytes].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
};

/** Write-amplification SLO: HOT bytes per decision must not regress past the baseline by more than `tolerance` (default 25%). */
export function amplificationIncident(baselineP95: number, currentP95: number, observedAt: string, tolerance = 0.25): PlatformIncident | null {
  return baselineP95 > 0 && currentP95 > baselineP95 * (1 + tolerance)
    ? incident('HOT_WRITE_AMPLIFICATION_REGRESSION', 'WARNING', {}, `hot p95 bytes per decision ${Math.round(currentP95)} > baseline ${Math.round(baselineP95)} by more than ${Math.round(tolerance * 100)}%`, observedAt) : null;
}

export function capacityForecastIncident(forecastPeakUtilization: number, limitUtilization: number, observedAt: string): PlatformIncident | null {
  return forecastPeakUtilization >= limitUtilization
    ? incident('DATABASE_CAPACITY_FORECAST_BREACH', forecastPeakUtilization >= 0.9 ? 'CRITICAL' : 'WARNING', {}, `forecast peak utilization ${forecastPeakUtilization.toFixed(3)} >= ${limitUtilization.toFixed(3)}`, observedAt) : null;
}
