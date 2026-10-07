// Performance analytics service layer (guide 44). Pure aggregation over resolved episodes, grouped by
// strategy / strategy version / regime, built on the existing R8 receipt (src/research/r8-performance-analytics.ts) so the
// metric definitions stay single-sourced. PROFITABILITY_STATUS is NOT_YET_PROVEN until the documented evidence threshold.

import { buildR8PerformanceReceipt, type R8EpisodeEvidence, type R8PerformanceReceipt } from '../../research/r8-performance-analytics.js';

export const performanceAnalyticsVersion = 'theta-performance-analytics-v1' as const;

export interface PerformanceEpisode {
  readonly episodeId: string;
  readonly strategy: string;
  readonly strategyVersion: string;
  /** Regime label at entry; null = UNKNOWN (grouped as 'UNKNOWN_REGIME', never dropped). */
  readonly regime: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly netPnlUsd: number | null;
  readonly grossPnlUsd: number | null;
  readonly feesUsd: number | null;
  readonly slippageUsd: number | null;
  readonly capitalRequiredUsd: number | null;
  readonly capitalDays: number | null;
  readonly assigned: boolean | null;
  readonly calledAway: boolean | null;
  /** Where the outcome came from. Only broker-confirmed Paper/Live fills can PROVE profitability. */
  readonly evidenceSource: 'BROKER_CONFIRMED_FILLS' | 'HISTORICAL_REPLAY_MODELED' | 'SHADOW_COUNTERFACTUAL';
}

/**
 * Evidence threshold (documented in docs/architecture/THETA_MANAGEMENT_ECONOMICS.md):
 *  - at least `minimumResolvedEpisodes` resolved episodes from BROKER_CONFIRMED_FILLS, AND
 *  - the 95% lower bound of mean net P&L per episode (normal approximation of the sample mean) > 0 -> PROVEN_POSITIVE,
 *    or the 95% upper bound < 0 -> PROVEN_NEGATIVE; otherwise NOT_YET_PROVEN.
 * Replay or shadow evidence never proves profitability; it is reported as RESEARCH_EVIDENCE_ONLY.
 */
export interface ProfitabilityEvidencePolicy { readonly minimumResolvedEpisodes: number }
export const defaultProfitabilityEvidencePolicy: ProfitabilityEvidencePolicy = { minimumResolvedEpisodes: 50 };

export type ProfitabilityStatus = 'NOT_YET_PROVEN' | 'PROVEN_POSITIVE_EXPECTANCY' | 'PROVEN_NEGATIVE_EXPECTANCY' | 'RESEARCH_EVIDENCE_ONLY';

export interface PerformanceGroupRow {
  readonly strategy: string;
  readonly strategyVersion: string;
  readonly regime: string;
  readonly n: number;
  readonly resolved: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly averageWin: number | null;
  readonly averageLoss: number | null;
  readonly expectancy: number | null;
  readonly profitFactor: number | null;
  readonly grossPnl: number | null;
  readonly netPnl: number | null;
  readonly maxDrawdown: number | null;
  readonly expectedShortfall5: number | null;
  readonly returnOnCapital: number | null;
  readonly returnPerCapitalDay: number | null;
  readonly averageHoldDays: number | null;
  readonly assignmentRate: number | null;
  readonly callAwayRate: number | null;
  readonly slippageUsd: number | null;
  readonly meanNetPnlLower95: number | null;
  readonly profitabilityStatus: ProfitabilityStatus;
  readonly r8: R8PerformanceReceipt;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const sumOrNull = (values: readonly (number | null)[]): number | null => values.length > 0 && values.every(finite)
  ? (values as number[]).reduce((a, b) => a + b, 0) : null;

export function profitabilityStatus(rows: readonly PerformanceEpisode[], policy: ProfitabilityEvidencePolicy = defaultProfitabilityEvidencePolicy):
  { readonly status: ProfitabilityStatus; readonly meanLower95: number | null; readonly meanUpper95: number | null } {
  const resolved = rows.filter((r) => r.closedAt !== null && finite(r.netPnlUsd));
  const broker = resolved.filter((r) => r.evidenceSource === 'BROKER_CONFIRMED_FILLS').map((r) => r.netPnlUsd as number);
  const stats = (xs: readonly number[]) => {
    if (xs.length < 2) return { lo: null, hi: null };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    const half = 1.959963984540054 * sd / Math.sqrt(xs.length);
    return { lo: mean - half, hi: mean + half };
  };
  if (broker.length === 0) return { status: resolved.length > 0 ? 'RESEARCH_EVIDENCE_ONLY' : 'NOT_YET_PROVEN', meanLower95: null, meanUpper95: null };
  const { lo, hi } = stats(broker);
  if (broker.length < policy.minimumResolvedEpisodes || lo === null || hi === null) return { status: 'NOT_YET_PROVEN', meanLower95: lo, meanUpper95: hi };
  return { status: lo > 0 ? 'PROVEN_POSITIVE_EXPECTANCY' : hi < 0 ? 'PROVEN_NEGATIVE_EXPECTANCY' : 'NOT_YET_PROVEN', meanLower95: lo, meanUpper95: hi };
}

export function buildPerformanceDashboard(episodes: readonly PerformanceEpisode[], policy: ProfitabilityEvidencePolicy = defaultProfitabilityEvidencePolicy): {
  readonly contractVersion: typeof performanceAnalyticsVersion; readonly rows: readonly PerformanceGroupRow[];
  readonly overallProfitabilityStatus: ProfitabilityStatus; readonly evidencePolicy: ProfitabilityEvidencePolicy } {
  const groups = new Map<string, PerformanceEpisode[]>();
  for (const e of episodes) {
    const key = JSON.stringify([e.strategy, e.strategyVersion, e.regime ?? 'UNKNOWN_REGIME']);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
    const [strategy, strategyVersion, regime] = JSON.parse(key) as [string, string, string];
    const ordered = list.toSorted((a, b) => Date.parse(a.closedAt ?? a.openedAt) - Date.parse(b.closedAt ?? b.openedAt) || a.episodeId.localeCompare(b.episodeId));
    const evidence: R8EpisodeEvidence[] = ordered.map((e) => ({
      episodeId: e.episodeId, lineage: { strategyVersion: e.strategyVersion, policyVersion: '', riskVersion: '', modelVersion: '', featureVersion: '',
        buildSha: '', fusionSnapshotId: '', reasonCodes: [] },
      navStart: null, navEnd: null, realizedPnl: e.closedAt === null ? null : e.netPnlUsd, unrealizedPnl: null, legPnl: null, managedEpisodePnl: null,
      wholeChainPnl: e.closedAt === null ? null : e.netPnlUsd, premiumCollected: null, stockPnl: null, feesAndCosts: e.feesUsd, tca: e.slippageUsd,
      mfe: null, mae: null, capitalDays: e.capitalDays, assigned: e.assigned, recoveryDurationDays: null, coveredCallContribution: null, calledAway: e.calledAway,
    }));
    // Equity curve from cumulative closed P&L (for drawdown only).
    let cumulative = 0;
    const equity = ordered.filter((e) => e.closedAt !== null && finite(e.netPnlUsd)).map((e, i) => {
      cumulative += e.netPnlUsd as number;
      return { at: new Date(Date.parse(e.closedAt as string) + i).toISOString(), equity: cumulative };
    });
    const r8 = buildR8PerformanceReceipt(evidence, equity.length >= 2 ? [{ at: new Date(Date.parse(equity[0]?.at as string) - 1).toISOString(), equity: 0 }, ...equity] : [], {});
    const resolved = ordered.filter((e) => e.closedAt !== null && finite(e.netPnlUsd));
    const capital = sumOrNull(resolved.map((e) => e.capitalRequiredUsd));
    const holds = resolved.map((e) => (Date.parse(e.closedAt as string) - Date.parse(e.openedAt)) / 86_400_000);
    const status = profitabilityStatus(list, policy);
    return {
      strategy, strategyVersion, regime, n: list.length, resolved: resolved.length,
      wins: resolved.filter((e) => (e.netPnlUsd as number) > 0).length, losses: resolved.filter((e) => (e.netPnlUsd as number) < 0).length,
      winRate: r8.winRate, averageWin: r8.averageWin, averageLoss: r8.averageLoss, expectancy: r8.expectancy, profitFactor: r8.profitFactor,
      grossPnl: sumOrNull(resolved.map((e) => e.grossPnlUsd)), netPnl: sumOrNull(resolved.map((e) => e.netPnlUsd)),
      maxDrawdown: r8.maxDrawdown, expectedShortfall5: r8.expectedShortfall,
      returnOnCapital: capital === null || capital <= 0 ? null : (sumOrNull(resolved.map((e) => e.netPnlUsd)) as number) / capital,
      returnPerCapitalDay: r8.returnPerCapitalDay, averageHoldDays: holds.length === 0 ? null : holds.reduce((a, b) => a + b, 0) / holds.length,
      assignmentRate: r8.assignmentRate, callAwayRate: r8.callAwayRate, slippageUsd: sumOrNull(resolved.map((e) => e.slippageUsd)),
      meanNetPnlLower95: status.meanLower95, profitabilityStatus: status.status, r8,
    };
  });
  return { contractVersion: performanceAnalyticsVersion, rows, overallProfitabilityStatus: profitabilityStatus(episodes, policy).status, evidencePolicy: policy };
}
