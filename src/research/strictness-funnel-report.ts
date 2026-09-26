/**
 * Phase 2 (2E/2H, Profitability Brain Completion Program) strictness/
 * funnel report. Composes over the existing real
 * `false-inactivity-taxonomy.ts` (12-cause classification) and
 * `wait-regret-dataset.ts` (real regret metrics) rather than inventing a
 * third, parallel vocabulary. Every field is `number | null`: `null`
 * means the underlying real modules cannot distinguish that concept from
 * the data given -- never a fabricated 0 or an invented statistic.
 *
 * `CandidateSurvivalRate`/`HardRejectRate`/`SizeZeroRate`/`WaitRate` are
 * derivable directly from a real `FalseInactivityRecord[]` batch.
 * `SoftDemotionRate` genuinely is NOT derivable from this taxonomy --
 * "demoted in rank but still survived" is not a distinct cause code in
 * `FalseInactivityCause` (a soft-demoted candidate that survives is not
 * recorded as any kind of reject at all), so it is honestly `null`
 * whenever only a `FalseInactivityRecord[]` batch is supplied.
 * `GateRegret`/`OpportunityCaptureRate`/`OverfilterSuspicion` are sourced
 * from the real `computeWaitRegretMetrics()` when a `WaitRegretRow[]`
 * batch is also supplied -- never invented from the taxonomy batch alone.
 */
import { computeFalseInactivityRates, type FalseInactivityRecord } from './false-inactivity-taxonomy.js';
import { computeWaitRegretMetrics, type WaitRegretRow } from './wait-regret-dataset.js';

export const strictnessFunnelReportVersion = 'theta-strictness-funnel-report-v1' as const;

export interface StrictnessFunnelReport {
  readonly contractVersion: typeof strictnessFunnelReportVersion;
  readonly totalCandidates: number;
  /** 1 - (hardReject + notEvaluated) rate -- fraction of candidates that
   * reached at least a soft-ranked or WAIT-economics state, never a
   * mechanical/hard-safety/pipeline-skip. `null` if totalCandidates=0. */
  readonly candidateSurvivalRate: number | null;
  readonly hardRejectRate: number | null;
  /** Genuinely not identifiable from `FalseInactivityRecord[]` alone --
   * see module docstring. Always `null` in the taxonomy-only path. */
  readonly softDemotionRate: null;
  readonly sizeZeroRate: number | null;
  readonly waitRate: number | null;
  /** Only populated when a real `WaitRegretRow[]` batch is supplied. */
  readonly gateRegretRate: number | null;
  readonly opportunityConversionRate: number | null;
  /** Reuses `falseRejectRate` from `computeWaitRegretMetrics` as the
   * real, denominator-safe proxy for "overfilter suspicion" -- named
   * differently here only because this report's field name matches the
   * Phase 2 directive's own vocabulary; the underlying computation is
   * identical, not a parallel invention. */
  readonly overfilterSuspicionRate: number | null;
}

/**
 * Builds the report from a real `FalseInactivityRecord[]` batch, with an
 * optional real `WaitRegretRow[]` batch for the regret-specific fields.
 * Passing neither produces an honestly-empty (`totalCandidates: 0`, every
 * rate `null`) report, never a crash and never a fabricated non-zero
 * value.
 */
export function buildStrictnessFunnelReport(
  taxonomyRecords: readonly FalseInactivityRecord[],
  waitRegretRows: readonly WaitRegretRow[] = [],
): StrictnessFunnelReport {
  const rates = computeFalseInactivityRates(taxonomyRecords);
  const notEvaluatedCount = taxonomyRecords.filter((r) => r.cause === 'PIPELINE_NOT_EVALUATED').length;
  const sizeZeroCount = taxonomyRecords.filter((r) => r.cause === 'SIZING_REJECT').length;
  const hardRejectCount = taxonomyRecords.filter((r) => r.cause === 'HARD_SAFETY_REJECT' || r.cause === 'EXECUTION_QUALITY_REJECT').length;
  const waitCount = taxonomyRecords.filter((r) => r.cause === 'GOOD_WAIT' || r.cause === 'ECONOMIC_WAIT').length;

  const waitRegret = waitRegretRows.length > 0 ? computeWaitRegretMetrics(waitRegretRows) : null;

  return {
    contractVersion: strictnessFunnelReportVersion,
    totalCandidates: rates.totalRecords,
    candidateSurvivalRate: rates.totalRecords === 0 ? null
      : 1 - (hardRejectCount + notEvaluatedCount) / rates.totalRecords,
    hardRejectRate: rates.totalRecords === 0 ? null : hardRejectCount / rates.totalRecords,
    softDemotionRate: null,
    sizeZeroRate: rates.totalRecords === 0 ? null : sizeZeroCount / rates.totalRecords,
    waitRate: rates.totalRecords === 0 ? null : waitCount / rates.totalRecords,
    gateRegretRate: waitRegret?.gateRegretRate ?? null,
    opportunityConversionRate: waitRegret?.opportunityConversionRate ?? null,
    overfilterSuspicionRate: waitRegret?.falseRejectRate ?? null,
  };
}
