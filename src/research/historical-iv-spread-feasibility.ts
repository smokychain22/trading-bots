import type { OptionomicsCapabilityObservation } from '../theta/optionomics-capability-contract.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO historical-data-provider decision and NO Production backfill
 * pipeline -- it only (1) inspects already-observed Optionomics capability
 * evidence (from `optionomics-capability-contract.ts`, Codex-owned) to
 * decide whether a PIT-valid IV/spread backfill is even POSSIBLE, and
 * (2) provides coverage/shock/stress research utilities to run once real
 * historical rows exist. It never fabricates capability evidence that was
 * not actually observed, and it never approximates a real historical
 * bid/ask from an OHLC bar.
 */
export const historicalIvSpreadFeasibilityVersion = 'theta-historical-iv-spread-feasibility-v1' as const;

export type HistoricalBackfillFeasibility =
  | 'HISTORICAL_IV_BACKFILL_SAFE' | 'HISTORICAL_IV_BACKFILL_NOT_SAFE' | 'CAPABILITY_EVIDENCE_INSUFFICIENT';

export interface BackfillFeasibilityAssessment {
  readonly feasibility: HistoricalBackfillFeasibility;
  readonly reasons: readonly string[];
}

const REQUIRED_IDENTITY_KEYS = ['underlying', 'expiration', 'strike', 'right'] as const;

/**
 * A PIT-valid backfill requires: (a) a proven SUPPORTED historical-data
 * capability (HISTORICAL_CHAINS or HISTORICAL_METRICS), (b) a real
 * observation timestamp field distinct from "now," and (c) full contract
 * identity (underlying/expiration/strike/right) in the schema -- without
 * all three, a backfill cannot be trusted not to silently replay
 * present-day data under a historical label. Absence of proof is treated
 * as absence of safety, never as an assumed pass.
 */
export function assessHistoricalIvBackfillFeasibility(
  observations: readonly OptionomicsCapabilityObservation[],
): BackfillFeasibilityAssessment {
  if (observations.length === 0) {
    return { feasibility: 'CAPABILITY_EVIDENCE_INSUFFICIENT', reasons: ['NO_CAPABILITY_OBSERVATIONS_RECORDED'] };
  }
  const historicalCapable = observations.filter((observation) =>
    (observation.family === 'HISTORICAL_CHAINS' || observation.family === 'HISTORICAL_METRICS')
    && observation.availability === 'SUPPORTED' && observation.historical === true
    && observation.httpStatus !== null && observation.httpStatus >= 200 && observation.httpStatus < 300);

  if (historicalCapable.length === 0) {
    return { feasibility: 'HISTORICAL_IV_BACKFILL_NOT_SAFE', reasons: ['NO_SUPPORTED_HISTORICAL_CAPABILITY_OBSERVED'] };
  }
  const reasons: string[] = [];
  const hasTimestampField = historicalCapable.some((observation) => observation.timestampField !== null);
  if (!hasTimestampField) reasons.push('NO_OBSERVATION_TIMESTAMP_FIELD_IN_SCHEMA');
  const hasFullIdentity = historicalCapable.some((observation) =>
    REQUIRED_IDENTITY_KEYS.every((key) => observation.schemaKeys.includes(key)));
  if (!hasFullIdentity) reasons.push('CONTRACT_IDENTITY_SCHEMA_INCOMPLETE');

  if (reasons.length > 0) return { feasibility: 'HISTORICAL_IV_BACKFILL_NOT_SAFE', reasons };
  return { feasibility: 'HISTORICAL_IV_BACKFILL_SAFE', reasons: ['SUPPORTED_HISTORICAL_CAPABILITY_WITH_TIMESTAMP_AND_FULL_IDENTITY'] };
}

export interface HistoricalIvObservationRow {
  readonly observationTimestamp: string;
  readonly sessionDate: string;
  readonly underlying: string;
  readonly contractId: string;
  readonly expiration: string;
  readonly dte: number | null;
  readonly delta: number | null;
  readonly iv: number | null;
}

export interface DteBinCount { readonly bin: string; readonly count: number }
export interface DeltaBinCount { readonly bin: string; readonly count: number }

export interface IvEffectiveCoverageReport {
  readonly rawRowCount: number;
  readonly distinctSessionDates: number;
  readonly distinctUnderlyings: number;
  readonly distinctContracts: number;
  readonly distinctExpirations: number;
  readonly dteBins: readonly DteBinCount[];
  readonly deltaBins: readonly DeltaBinCount[];
  /** Distinct (underlying, contractId, sessionDate) triples -- the
   * independent-snapshot count after removing intraday/duplicate-poll
   * repetition, since ten polls of the same contract on the same session
   * are one observation of IV for coverage purposes, not ten. */
  readonly effectiveIndependentSnapshots: number;
}

function dteBinLabel(dte: number | null): string {
  if (dte === null) return 'UNKNOWN';
  if (dte <= 7) return '0-7';
  if (dte <= 21) return '8-21';
  if (dte <= 45) return '22-45';
  if (dte <= 90) return '46-90';
  return '90+';
}

function deltaBinLabel(delta: number | null): string {
  if (delta === null) return 'UNKNOWN';
  const magnitude = Math.abs(delta);
  if (magnitude <= 0.15) return '0.00-0.15';
  if (magnitude <= 0.30) return '0.15-0.30';
  if (magnitude <= 0.50) return '0.30-0.50';
  if (magnitude <= 0.70) return '0.50-0.70';
  return '0.70-1.00';
}

function countBins<T extends string>(labels: readonly T[]): readonly { readonly bin: T; readonly count: number }[] {
  const counts = new Map<T, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()].map(([bin, count]) => ({ bin, count })).sort((left, right) => left.bin.localeCompare(right.bin));
}

export function buildIvEffectiveCoverageReport(rows: readonly HistoricalIvObservationRow[]): IvEffectiveCoverageReport {
  const distinctSessionDates = new Set(rows.map((row) => row.sessionDate)).size;
  const distinctUnderlyings = new Set(rows.map((row) => row.underlying)).size;
  const distinctContracts = new Set(rows.map((row) => row.contractId)).size;
  const distinctExpirations = new Set(rows.map((row) => row.expiration)).size;
  const effectiveIndependentSnapshots = new Set(rows.map((row) => `${row.underlying}|${row.contractId}|${row.sessionDate}`)).size;
  return {
    rawRowCount: rows.length, distinctSessionDates, distinctUnderlyings, distinctContracts, distinctExpirations,
    dteBins: countBins(rows.map((row) => dteBinLabel(row.dte))),
    deltaBins: countBins(rows.map((row) => deltaBinLabel(row.delta))),
    effectiveIndependentSnapshots,
  };
}

export const MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH = 20;

export type IvShockResearchStatus = 'COMPUTED' | 'TEMPORAL_HISTORY_INSUFFICIENT';

export interface IvShockObservation {
  readonly sessionDate: string;
  readonly rollingMedian: number | null;
  readonly rollingPercentileRank: number | null;
  readonly change: number | null;
  readonly robustZScore: number | null;
}

export interface IvShockResearchResult {
  readonly status: IvShockResearchStatus;
  readonly cohortKey: string;
  readonly snapshotCount: number;
  readonly observations: readonly IvShockObservation[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function medianAbsoluteDeviation(values: readonly number[], centerMedian: number): number {
  return median(values.map((value) => Math.abs(value - centerMedian)));
}

/**
 * IV shock research for one already-filtered cohort (a single underlying /
 * DTE bin / delta region, chosen by the caller), computed strictly PIT-safe:
 * every stat at session index i uses ONLY sessions [0, i) (or [0, i]
 * inclusive of the CURRENT day's own value where noted), never a future
 * session. Requires at least MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH prior
 * sessions before reporting a stat for a given day; earlier days report
 * null rather than a statistic computed on too few points.
 */
export function computeIvShockResearch(
  cohortKey: string, sessions: readonly { readonly sessionDate: string; readonly iv: number | null }[],
): IvShockResearchResult {
  const known = sessions.filter((session) => session.iv !== null) as readonly { readonly sessionDate: string; readonly iv: number }[];
  if (known.length < MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH) {
    return { status: 'TEMPORAL_HISTORY_INSUFFICIENT', cohortKey, snapshotCount: known.length, observations: [] };
  }
  const observations: IvShockObservation[] = known.map((session, index) => {
    const priorWindow = known.slice(0, index).map((row) => row.iv);
    if (priorWindow.length < MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH - 1) {
      return { sessionDate: session.sessionDate, rollingMedian: null, rollingPercentileRank: null, change: null, robustZScore: null };
    }
    const priorMedian = median(priorWindow);
    const mad = medianAbsoluteDeviation(priorWindow, priorMedian);
    const rank = priorWindow.filter((value) => value <= session.iv).length / priorWindow.length;
    const previous = known[index - 1];
    return {
      sessionDate: session.sessionDate,
      rollingMedian: priorMedian,
      rollingPercentileRank: rank,
      change: previous !== undefined ? session.iv - previous.iv : null,
      robustZScore: mad > 0 ? (0.6745 * (session.iv - priorMedian)) / mad : null,
    };
  });
  return { status: 'COMPUTED', cohortKey, snapshotCount: known.length, observations };
}

export interface HistoricalBboObservationRow {
  readonly observationTimestamp: string;
  readonly sessionDate: string;
  readonly underlying: string;
  readonly contractId: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly isStale: boolean;
}

export type BboRowValidityReason = 'VALID' | 'BID_NON_POSITIVE' | 'ASK_LESS_THAN_BID' | 'STALE' | 'MISSING';

export interface SpreadEffectiveCoverageReport {
  readonly rawRowCount: number;
  readonly validRowCount: number;
  readonly invalidRowCounts: Readonly<Record<Exclude<BboRowValidityReason, 'VALID'>, number>>;
  readonly distinctSessionDates: number;
  readonly distinctContracts: number;
  readonly effectiveIndependentSnapshots: number;
}

function classifyBboRow(row: HistoricalBboObservationRow): BboRowValidityReason {
  if (row.bid === null || row.ask === null) return 'MISSING';
  if (row.isStale) return 'STALE';
  if (!(row.bid > 0)) return 'BID_NON_POSITIVE';
  if (row.ask < row.bid) return 'ASK_LESS_THAN_BID';
  return 'VALID';
}

/**
 * Coverage report over TRUE historical bid/ask rows only -- callers must
 * never pass an OHLC-bar-derived approximation into this function, since
 * this module has no way to detect that at the type level and treating a
 * bar midpoint as a historical quote would be exactly the fabrication the
 * directive prohibits.
 */
export function buildSpreadEffectiveCoverageReport(rows: readonly HistoricalBboObservationRow[]): SpreadEffectiveCoverageReport {
  const classifications = rows.map((row) => classifyBboRow(row));
  const validRows = rows.filter((_, index) => classifications[index] === 'VALID');
  const invalidRowCounts = { BID_NON_POSITIVE: 0, ASK_LESS_THAN_BID: 0, STALE: 0, MISSING: 0 };
  for (const classification of classifications) {
    if (classification !== 'VALID') invalidRowCounts[classification] += 1;
  }
  return {
    rawRowCount: rows.length, validRowCount: validRows.length, invalidRowCounts,
    distinctSessionDates: new Set(validRows.map((row) => row.sessionDate)).size,
    distinctContracts: new Set(validRows.map((row) => row.contractId)).size,
    effectiveIndependentSnapshots: new Set(validRows.map((row) => `${row.underlying}|${row.contractId}|${row.sessionDate}`)).size,
  };
}

export const MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH = 20;

export type SpreadStressResearchStatus = 'COMPUTED' | 'TEMPORAL_HISTORY_INSUFFICIENT';

export interface SpreadStressObservation {
  readonly sessionDate: string;
  readonly spreadPct: number | null;
  readonly rollingMedianSpreadPct: number | null;
  readonly robustZScore: number | null;
}

export interface SpreadStressResearchResult {
  readonly status: SpreadStressResearchStatus;
  readonly cohortKey: string;
  readonly snapshotCount: number;
  readonly observations: readonly SpreadStressObservation[];
}

/**
 * spreadPct = (ask - bid) / midpoint, guarded against a near-zero midpoint
 * denominator (reported null, never Infinity/NaN). Only VALID rows
 * (bid > 0, ask >= bid, not stale) are given a defined spreadPct; an
 * invalid row's spreadPct stays null (UNKNOWN), never coerced to zero.
 */
export function computeSpreadStressResearch(
  cohortKey: string, rows: readonly HistoricalBboObservationRow[],
): SpreadStressResearchResult {
  const withSpread = rows.map((row) => {
    const valid = classifyBboRow(row) === 'VALID';
    if (!valid || row.bid === null || row.ask === null) return { sessionDate: row.sessionDate, spreadPct: null as number | null };
    const midpoint = (row.bid + row.ask) / 2;
    if (!(midpoint > 1e-9)) return { sessionDate: row.sessionDate, spreadPct: null as number | null };
    return { sessionDate: row.sessionDate, spreadPct: (row.ask - row.bid) / midpoint };
  });
  const knownCount = withSpread.filter((row) => row.spreadPct !== null).length;
  if (knownCount < MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH) {
    return { status: 'TEMPORAL_HISTORY_INSUFFICIENT', cohortKey, snapshotCount: knownCount, observations: [] };
  }
  // Row-aligned output: every input row (valid or invalid) gets an observation, so an
  // invalid row's date is visible as UNKNOWN rather than silently disappearing from the
  // report. Rolling stats accumulate only from prior VALID rows, invalid rows are skipped
  // when building the prior window but never removed from the output alignment.
  const priorValidSpreads: number[] = [];
  const observations: SpreadStressObservation[] = withSpread.map((row) => {
    if (row.spreadPct === null) {
      return { sessionDate: row.sessionDate, spreadPct: null, rollingMedianSpreadPct: null, robustZScore: null };
    }
    let result: SpreadStressObservation;
    if (priorValidSpreads.length < MIN_SNAPSHOTS_FOR_SPREAD_STRESS_RESEARCH - 1) {
      result = { sessionDate: row.sessionDate, spreadPct: row.spreadPct, rollingMedianSpreadPct: null, robustZScore: null };
    } else {
      const priorMedian = median(priorValidSpreads);
      const mad = medianAbsoluteDeviation(priorValidSpreads, priorMedian);
      result = {
        sessionDate: row.sessionDate, spreadPct: row.spreadPct, rollingMedianSpreadPct: priorMedian,
        robustZScore: mad > 0 ? (0.6745 * (row.spreadPct - priorMedian)) / mad : null,
      };
    }
    priorValidSpreads.push(row.spreadPct);
    return result;
  });
  return { status: 'COMPUTED', cohortKey, snapshotCount: knownCount, observations };
}
