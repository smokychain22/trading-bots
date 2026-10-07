// Metrics, regime labels and walk-forward profile selection for the Q policy replay.

import { buildR8PerformanceReceipt, type R8EpisodeEvidence } from '../r8-performance-analytics.js';
import type { Episode, UnderlyingHistory } from './replay-engine.js';

// ---------------------------------------------------------------------------
// Regime (IMPLEMENTATION_INFERENCE thresholds; point-in-time, trailing data only)
// ---------------------------------------------------------------------------

/** Trend = annualized OLS slope of ln(close) over the trailing 50 sessions; vol = RV20 tercile vs the trailing 252 RV20 values. */
export function regimeAt(history: UnderlyingHistory, index: number): string {
  if (index < 50) return 'UNKNOWN_INSUFFICIENT_HISTORY';
  const window = history.closes.slice(index - 49, index + 1).map(Math.log);
  const n = window.length, xMean = (n - 1) / 2, yMean = window.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  window.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = (num / den) * 252;
  const trend = slope >= 0.25 ? 'STRONG_UP' : slope >= 0 ? 'UP' : slope > -0.25 ? 'DOWN' : 'STRONG_DOWN';
  const rv20 = (end: number): number | null => {
    if (end < 21) return null;
    const r = [];
    for (let i = end - 19; i <= end; i++) r.push(Math.log((history.closes[i] as number) / (history.closes[i - 1] as number)));
    const m = r.reduce((s, v) => s + v, 0) / r.length;
    return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1) * 252);
  };
  const current = rv20(index);
  const trailing: number[] = [];
  for (let i = Math.max(21, index - 251); i < index; i++) { const v = rv20(i); if (v !== null) trailing.push(v); }
  if (current === null || trailing.length < 40) return `${trend}|VOL_UNKNOWN`;
  const sorted = trailing.sort((x, y) => x - y);
  const t1 = sorted[Math.floor(sorted.length / 3)] as number, t2 = sorted[Math.floor((2 * sorted.length) / 3)] as number;
  return `${trend}|${current <= t1 ? 'VOL_LOW' : current <= t2 ? 'VOL_MID' : 'VOL_HIGH'}`;
}

/** Annualized close-to-close volatility through `index`, using only the trailing completed observations. */
export function realizedVolatilityAt(history: UnderlyingHistory, index: number, lookback = 20): number | null {
  if (lookback < 2 || index < lookback) return null;
  const returns: number[] = [];
  for (let i = index - lookback + 1; i <= index; i++) {
    const previous = history.closes[i - 1];
    const current = history.closes[i];
    if (previous === undefined || current === undefined || !(previous > 0) || !(current > 0)) return null;
    returns.push(Math.log(current / previous));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) * 252);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface PolicyMetrics {
  readonly n: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly winRateWilson95: readonly [number, number] | null;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly expectancy: number | null;
  readonly profitFactor: number | null;
  readonly maxDrawdown: number | null;
  readonly expectedShortfall5: number | null;
  readonly meanRoc: number | null;
  readonly expectedShortfall5Roc: number | null;
  readonly maxDrawdownRocUnits: number | null;
  /** ES5 of maximum adverse excursion / capital: path risk that realized P&L hides when losses are held, not realized. */
  readonly expectedShortfall5MaeRoc: number | null;
  readonly grossPnl: number;
  readonly modeledCosts: number;
  readonly totalPnl: number;
  readonly returnPerCapitalDay: number | null;
  readonly annualizedReturnOnCapitalDays: number | null;
  readonly assignmentRate: number | null;
  readonly averageHoldDays: number | null;
  readonly modeledSlippageTotal: number;
  readonly modelPricedExitCount: number;
}

const lineage = { strategyVersion: 'replay', policyVersion: 'replay', riskVersion: 'replay', modelVersion: 'replay',
  featureVersion: 'replay', buildSha: 'replay', fusionSnapshotId: 'replay', reasonCodes: [] };
const r8Episode = (e: Episode, index: number, value: number): R8EpisodeEvidence => ({
  episodeId: `${e.underlying}:${e.entryDate}:${e.symbol}:${index}`, lineage, navStart: null, navEnd: null, realizedPnl: value,
  unrealizedPnl: 0, legPnl: value, managedEpisodePnl: value, wholeChainPnl: value, premiumCollected: null, stockPnl: null,
  feesAndCosts: null, tca: null, mfe: null, mae: null, capitalDays: e.capitalDays, assigned: e.assigned, recoveryDurationDays: null,
  coveredCallContribution: null, calledAway: null });

/** Drawdown on the cumulative series ordered by exit date (same-day exits aggregated). */
function maxDrawdown(episodes: readonly Episode[], value: (e: Episode) => number): number | null {
  if (episodes.length === 0) return null;
  const byDate = new Map<string, number>();
  for (const e of episodes) byDate.set(e.exitDate, (byDate.get(e.exitDate) ?? 0) + value(e));
  let equity = 0, peak = 0, worst = 0;
  for (const date of [...byDate.keys()].sort()) { equity += byDate.get(date) as number; peak = Math.max(peak, equity); worst = Math.min(worst, equity - peak); }
  return worst;
}

export function computePolicyMetrics(episodes: readonly Episode[]): PolicyMetrics {
  const pnl = buildR8PerformanceReceipt(episodes.map((e, i) => r8Episode(e, i, e.pnl)), []);
  const roc = buildR8PerformanceReceipt(episodes.map((e, i) => r8Episode(e, i, e.roc)), []);
  const mae = buildR8PerformanceReceipt(episodes.map((e, i) => r8Episode(e, i, e.maeUsd / e.capital)), []);
  const wins = episodes.filter((e) => e.pnl > 0).length, losses = episodes.filter((e) => e.pnl < 0).length;
  const capitalDays = episodes.reduce((s, e) => s + e.capitalDays, 0);
  const totalPnl = episodes.reduce((s, e) => s + e.pnl, 0);
  const perDay = capitalDays > 0 ? totalPnl / capitalDays : null;
  return {
    n: episodes.length, wins, losses, winRate: pnl.winRate,
    winRateWilson95: pnl.winRateInterval95 === null ? null : [pnl.winRateInterval95.lower, pnl.winRateInterval95.upper],
    averageWin: pnl.averageWin, averageLoss: pnl.averageLoss, expectancy: pnl.expectancy, profitFactor: pnl.profitFactor,
    maxDrawdown: maxDrawdown(episodes, (e) => e.pnl), expectedShortfall5: pnl.expectedShortfall,
    meanRoc: roc.expectancy, expectedShortfall5Roc: roc.expectedShortfall, maxDrawdownRocUnits: maxDrawdown(episodes, (e) => e.roc),
    expectedShortfall5MaeRoc: mae.expectedShortfall,
    grossPnl: episodes.reduce((sum, episode) => sum + episode.grossPnl, 0),
    modeledCosts: episodes.reduce((sum, episode) => sum + episode.modeledCosts, 0),
    totalPnl, returnPerCapitalDay: perDay, annualizedReturnOnCapitalDays: perDay === null ? null : perDay * 365,
    assignmentRate: episodes.length === 0 ? null : episodes.filter((e) => e.assigned).length / episodes.length,
    averageHoldDays: episodes.length === 0 ? null : episodes.reduce((s, e) => s + e.holdDays, 0) / episodes.length,
    modeledSlippageTotal: episodes.reduce((s, e) => s + e.modeledSlippage, 0),
    modelPricedExitCount: episodes.filter((e) => e.modelPricedExit).length,
  };
}

export function bucketize(episodes: readonly Episode[], key: (e: Episode) => string): Readonly<Record<string, PolicyMetrics>> {
  const groups = new Map<string, Episode[]>();
  for (const e of episodes) { const k = key(e); groups.set(k, [...(groups.get(k) ?? []), e]); }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, computePolicyMetrics(v)]));
}

export const bucketKeys = {
  delta: (e: Episode) => e.features.absDelta === null ? 'UNKNOWN' : e.features.absDelta < 0.1 ? '0.00-0.10' : e.features.absDelta < 0.2 ? '0.10-0.20'
    : e.features.absDelta < 0.3 ? '0.20-0.30' : '0.30-0.50',
  dte: (e: Episode) => e.features.dte < 35 ? '25-34' : e.features.dte < 45 ? '35-44' : '45-60',
  iv: (e: Episode) => e.features.iv === null ? 'UNKNOWN' : e.features.iv < 0.2 ? '<0.20' : e.features.iv < 0.3 ? '0.20-0.30' : e.features.iv < 0.45 ? '0.30-0.45' : '>=0.45',
  ivRv: (e: Episode) => e.features.ivToRvRatio === null ? 'UNKNOWN' : e.features.ivToRvRatio < 0.8 ? '<0.80'
    : e.features.ivToRvRatio < 1 ? '0.80-1.00' : e.features.ivToRvRatio < 1.2 ? '1.00-1.20' : '>=1.20',
  cushionSigma: (e: Episode) => e.features.cushionSigmas === null ? 'UNKNOWN' : e.features.cushionSigmas < 0.5 ? '<0.5' : e.features.cushionSigmas < 1 ? '0.5-1.0'
    : e.features.cushionSigmas < 1.5 ? '1.0-1.5' : '>=1.5',
  underlying: (e: Episode) => e.underlying,
  sector: (e: Episode) => e.features.underlyingSector,
  regime: (e: Episode) => e.features.regime,
};

// ---------------------------------------------------------------------------
// Walk-forward
// ---------------------------------------------------------------------------

export interface SplitPlan { readonly trainEnd: string; readonly validationEnd: string }
export type Split = 'TRAIN' | 'VALIDATION' | 'OOS';
/** Episodes belong to the split of their ENTRY date. */
export const splitOf = (entryDate: string, plan: SplitPlan): Split => entryDate <= plan.trainEnd ? 'TRAIN' : entryDate <= plan.validationEnd ? 'VALIDATION' : 'OOS';

export interface CandidatePolicyEvidence {
  readonly policyId: string;
  /** TRAIN + VALIDATION metrics only; selection never reads OOS. */
  readonly inSample: PolicyMetrics;
  /**
   * The same policy's in-sample metrics under execution stresses (2x modeled spread, adverse trade prints). A policy is
   * eligible only if its expectancy stays positive under every supplied stress: a policy whose apparent edge exists only at
   * favourable daily trade prints (or that "never lost" in-sample) must not be chosen.
   */
  readonly inSampleStress?: readonly PolicyMetrics[];
}

export type ProfileName = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export interface ProfileChoice { readonly profile: ProfileName; readonly policyId: string | null; readonly rule: string }

const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] as number;
};

/**
 * Declared multi-objective rule, applied to in-sample evidence only (N >= minN, positive in-sample expectancy):
 * The tail measure is the ES5 of MAXIMUM ADVERSE EXCURSION / capital (path risk), not realized ES: a no-stop policy that
 * holds losers until they recover never shows a realized loss.
 *  CONSERVATIVE: ES5(MAE ROC) in the best (least negative) third AND max ROC drawdown in the best half -> highest return/capital-day.
 *  BALANCED: ES5(MAE ROC) and max ROC drawdown both no worse than the median -> highest return/capital-day.
 *  AGGRESSIVE: max ROC drawdown no worse than the 75th-percentile-worst -> highest return/capital-day.
 */
export function chooseProfiles(evidence: readonly CandidatePolicyEvidence[], minN = 20): readonly ProfileChoice[] {
  const pool = evidence.filter((e) => e.inSample.n >= minN && (e.inSample.expectancy ?? 0) > 0
    && (e.inSampleStress ?? []).every((m) => m.n >= minN && (m.expectancy ?? 0) > 0)
    && e.inSample.expectedShortfall5MaeRoc !== null && e.inSample.maxDrawdownRocUnits !== null && e.inSample.returnPerCapitalDay !== null);
  if (pool.length === 0) return (['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const).map((profile) => ({ profile, policyId: null, rule: 'NO_ELIGIBLE_POLICY' }));
  const es = pool.map((e) => e.inSample.expectedShortfall5MaeRoc as number), dd = pool.map((e) => e.inSample.maxDrawdownRocUnits as number);
  const best = (filter: (e: CandidatePolicyEvidence) => boolean) => pool.filter(filter)
    .toSorted((a, b) => (b.inSample.returnPerCapitalDay as number) - (a.inSample.returnPerCapitalDay as number) || a.policyId.localeCompare(b.policyId))[0]?.policyId ?? null;
  return [
    { profile: 'CONSERVATIVE', policyId: best((e) => (e.inSample.expectedShortfall5MaeRoc as number) >= quantile(es, 2 / 3)
      && (e.inSample.maxDrawdownRocUnits as number) >= quantile(dd, 0.5)), rule: 'ES5_TOP_THIRD_AND_DD_TOP_HALF_THEN_MAX_RETURN_PER_CAPITAL_DAY' },
    { profile: 'BALANCED', policyId: best((e) => (e.inSample.expectedShortfall5MaeRoc as number) >= quantile(es, 0.5)
      && (e.inSample.maxDrawdownRocUnits as number) >= quantile(dd, 0.5)), rule: 'ES5_AND_DD_AT_LEAST_MEDIAN_THEN_MAX_RETURN_PER_CAPITAL_DAY' },
    { profile: 'AGGRESSIVE', policyId: best((e) => (e.inSample.maxDrawdownRocUnits as number) >= quantile(dd, 0.25)),
      rule: 'DD_NOT_IN_WORST_QUARTER_THEN_MAX_RETURN_PER_CAPITAL_DAY' },
  ];
}

/**
 * In-sample episodes for profile selection: entered AND exited on or before the validation end, so no outcome revealed
 * after the in-sample window can influence selection.
 */
export const inSampleEpisodes = (episodes: readonly Episode[], plan: SplitPlan): readonly Episode[] =>
  episodes.filter((e) => e.entryDate <= plan.validationEnd && e.exitDate <= plan.validationEnd);
export const oosEpisodes = (episodes: readonly Episode[], plan: SplitPlan): readonly Episode[] =>
  episodes.filter((e) => splitOf(e.entryDate, plan) === 'OOS');
