/**
 * COMMAND 5C-7 item 40: recovery-duration survival baseline. Real
 * Kaplan-Meier empirical survival estimator over `RecoverySurvivalRow`
 * (`recovery-survival-dataset.ts`, already real) with proper right
 * censoring -- the required baseline before any more complex survival
 * model (Cox/AFT/parametric) may be attempted as a challenger.
 */
import type { RecoverySurvivalRow } from './recovery-survival-dataset.js';

export const recoverySurvivalBaselineVersion = 'theta-recovery-survival-baseline-v1' as const;

export interface KaplanMeierPoint {
  readonly calendarDays: number;
  readonly atRisk: number;
  readonly events: number;
  /** Survival probability estimate at this time point -- product of
   * (1 - events/atRisk) across every event time up to and including this
   * one, the standard Kaplan-Meier product-limit formula. */
  readonly survivalProbability: number;
}

export interface KaplanMeierSurvivalCurve {
  readonly contractVersion: typeof recoverySurvivalBaselineVersion;
  readonly independentN: number;
  readonly eventCount: number;
  readonly censoredCount: number;
  readonly curve: readonly KaplanMeierPoint[];
  readonly medianSurvivalDays: number | null;
}

/**
 * Standard Kaplan-Meier product-limit estimator. Censored observations
 * (RIGHT_CENSORED rows) contribute to the at-risk set at every time up to
 * their own censoring time but never count as an event -- the textbook
 * distinction this baseline exists to get right, rather than treating a
 * still-open recovery as either "resolved at cutoff" or silently dropped.
 */
export function buildKaplanMeierSurvivalCurve(rows: readonly RecoverySurvivalRow[]): KaplanMeierSurvivalCurve {
  const n = rows.length;
  if (n === 0) {
    return { contractVersion: recoverySurvivalBaselineVersion, independentN: 0, eventCount: 0, censoredCount: 0, curve: [], medianSurvivalDays: null };
  }
  const eventTimes = [...new Set(rows.filter((r) => r.status === 'RESOLVED').map((r) => r.calendarDays))].sort((a, b) => a - b);
  let survival = 1;
  const curve: KaplanMeierPoint[] = [];
  for (const t of eventTimes) {
    const atRisk = rows.filter((r) => r.calendarDays >= t).length;
    const events = rows.filter((r) => r.status === 'RESOLVED' && r.calendarDays === t).length;
    if (atRisk === 0) continue;
    survival *= 1 - events / atRisk;
    curve.push({ calendarDays: t, atRisk, events, survivalProbability: survival });
  }
  const medianPoint = curve.find((p) => p.survivalProbability <= 0.5);
  return {
    contractVersion: recoverySurvivalBaselineVersion,
    independentN: n,
    eventCount: rows.filter((r) => r.status === 'RESOLVED').length,
    censoredCount: rows.filter((r) => r.status === 'RIGHT_CENSORED').length,
    curve,
    medianSurvivalDays: medianPoint?.calendarDays ?? null,
  };
}
