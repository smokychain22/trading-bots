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
 *
 * All historical bid/ask here is Optionomics SESSION-RECORDED RESEARCH
 * data (confirmed against `optionomics-quote-proof.ts`'s canonical
 * `quoteSemantics: 'SESSION_RECORDED_RESEARCH'`), never broker-executable
 * BBO -- see `OptionomicsHistoricalQuoteObservationRow` below, named
 * deliberately to avoid the word "BBO."
 */
export const historicalIvSpreadFeasibilityVersion = 'theta-historical-iv-spread-feasibility-v2' as const;

export type HistoricalBackfillFeasibility =
  | 'HISTORICAL_IV_BACKFILL_SAFE' | 'HISTORICAL_IV_BACKFILL_NOT_SAFE' | 'CAPABILITY_EVIDENCE_INSUFFICIENT';

export interface BackfillFeasibilityAssessment {
  readonly feasibility: HistoricalBackfillFeasibility;
  readonly reasons: readonly string[];
}

const REQUIRED_IDENTITY_KEYS = ['underlying', 'expiration', 'strike', 'right'] as const;

/**
 * Pairs a raw capability observation with an explicit, caller-supplied
 * attestation that ITS OWN historical claim was independently verified --
 * e.g. by actually requesting an old date through this exact operation and
 * confirming the served session/date matched, not merely inferred from a
 * `historical: true` flag or a plausible-looking schema/field name.
 * Defaults to `false` wherever not explicitly set `true`. Mirrors the
 * `providerTimestampIndependentlyVerified` repair pattern in
 * event-pit-toolkit.ts (Codex's A-D acceptance review flagged the same
 * class of defect in both modules: a provider's self-description is not
 * proof of historical retrievability).
 */
export interface HistoricalCapabilityAttestation {
  readonly observation: OptionomicsCapabilityObservation;
  readonly verifiedHistoricalRetrievability: boolean;
}

/**
 * A PIT-valid backfill requires ONE SINGLE observation that simultaneously
 * proves: (a) a SUPPORTED historical-data capability (HISTORICAL_CHAINS or
 * HISTORICAL_METRICS), (b) a real observation timestamp field, (c) full
 * contract identity (underlying/expiration/strike/right) in its schema,
 * AND (d) independently verified historical retrievability. Repair for a
 * defect Codex's A-D acceptance review found (docs/research/
 * THETA_CLAUDE_A_D_ACCEPTANCE_2026-09-21.md, item D): the prior version
 * used two SEPARATE `.some()` checks over the same observation array,
 * which could combine timestamp evidence from one inadequate observation
 * with identity evidence from a DIFFERENT inadequate observation and
 * wrongly conclude both properties held together, when no single real
 * endpoint response actually proved that. Absence of proof is treated as
 * absence of safety, never as an assumed pass.
 */
export function assessHistoricalIvBackfillFeasibility(
  attestations: readonly HistoricalCapabilityAttestation[],
): BackfillFeasibilityAssessment {
  if (attestations.length === 0) {
    return { feasibility: 'CAPABILITY_EVIDENCE_INSUFFICIENT', reasons: ['NO_CAPABILITY_OBSERVATIONS_RECORDED'] };
  }
  const historicallyCapable = attestations.filter(({ observation }) =>
    (observation.family === 'HISTORICAL_CHAINS' || observation.family === 'HISTORICAL_METRICS')
    && observation.availability === 'SUPPORTED' && observation.historical === true
    && observation.httpStatus !== null && observation.httpStatus >= 200 && observation.httpStatus < 300);

  if (historicallyCapable.length === 0) {
    return { feasibility: 'HISTORICAL_IV_BACKFILL_NOT_SAFE', reasons: ['NO_SUPPORTED_HISTORICAL_CAPABILITY_OBSERVED'] };
  }

  const fullyProven = historicallyCapable.find(({ observation, verifiedHistoricalRetrievability }) =>
    observation.timestampField !== null
    && REQUIRED_IDENTITY_KEYS.every((key) => observation.schemaKeys.includes(key))
    && verifiedHistoricalRetrievability === true);

  if (fullyProven !== undefined) {
    return { feasibility: 'HISTORICAL_IV_BACKFILL_SAFE', reasons: ['SINGLE_OBSERVATION_PROVES_TIMESTAMP_IDENTITY_AND_VERIFIED_RETRIEVABILITY_TOGETHER'] };
  }
  const reasons: string[] = [];
  if (!historicallyCapable.some(({ observation }) => observation.timestampField !== null)) reasons.push('NO_OBSERVATION_TIMESTAMP_FIELD_IN_SCHEMA');
  if (!historicallyCapable.some(({ observation }) => REQUIRED_IDENTITY_KEYS.every((key) => observation.schemaKeys.includes(key)))) reasons.push('CONTRACT_IDENTITY_SCHEMA_INCOMPLETE');
  if (!historicallyCapable.some((a) => a.verifiedHistoricalRetrievability === true)) reasons.push('HISTORICAL_RETRIEVABILITY_NOT_INDEPENDENTLY_VERIFIED');
  if (reasons.length === 0) reasons.push('NO_SINGLE_OBSERVATION_PROVES_ALL_REQUIREMENTS_TOGETHER');
  return { feasibility: 'HISTORICAL_IV_BACKFILL_NOT_SAFE', reasons };
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

function validSessionDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/**
 * Sorts sessions chronologically by `sessionDate` (repair: the prior
 * version trusted caller-supplied array order, so an out-of-order input
 * silently corrupted every "prior window" computation -- Codex's A-D
 * acceptance review named this "enforce cutoff/observation ordering").
 * Drops any row with an unparseable sessionDate entirely (never included
 * in either the chronology or the snapshot count) and any row whose
 * sessionDate is NOT strictly before `completedSessionsOnlyThrough` --
 * the repair for "separate same-day/current-session rows from completed
 * historical sessions": a same-day or future-dated row cannot be treated
 * as a completed historical observation.
 */
function sortAndFilterToCompletedSessions<T extends { readonly sessionDate: string }>(
  sessions: readonly T[], completedSessionsOnlyThrough: string,
): readonly T[] {
  if (!validSessionDate(completedSessionsOnlyThrough)) throw new Error('COMPLETED_SESSIONS_ONLY_THROUGH_INVALID');
  const cutoffMillis = Date.parse(completedSessionsOnlyThrough);
  return sessions
    .filter((session) => validSessionDate(session.sessionDate) && Date.parse(session.sessionDate) < cutoffMillis)
    .slice()
    .sort((left, right) => Date.parse(left.sessionDate) - Date.parse(right.sessionDate));
}

/**
 * IV shock research for one already-filtered cohort (a single underlying /
 * DTE bin / delta region, chosen by the caller), computed strictly PIT-safe:
 * every stat at session index i uses ONLY sessions [0, i) (or [0, i]
 * inclusive of the CURRENT day's own value where noted), never a future
 * session. Requires at least MIN_SNAPSHOTS_FOR_IV_SHOCK_RESEARCH prior
 * sessions before reporting a stat for a given day; earlier days report
 * null rather than a statistic computed on too few points.
 *
 * `completedSessionsOnlyThrough` (an ISO date/instant) is required: any
 * session on or after it -- same-day/current or future -- is excluded
 * before computation, per the repair described on
 * `sortAndFilterToCompletedSessions` above.
 */
export function computeIvShockResearch(
  cohortKey: string, sessions: readonly { readonly sessionDate: string; readonly iv: number | null }[],
  completedSessionsOnlyThrough: string,
): IvShockResearchResult {
  const ordered = sortAndFilterToCompletedSessions(sessions, completedSessionsOnlyThrough);
  const known = ordered.filter((session) => session.iv !== null) as readonly { readonly sessionDate: string; readonly iv: number }[];
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

/**
 * Optionomics session-recorded RESEARCH quote observation. Deliberately
 * NOT named "BBO" -- Optionomics documents its option-chain quotes as
 * SESSION_RECORDED_RESEARCH data (see `optionomics-quote-proof.ts`'s
 * `quoteSemantics` field), not a broker-executable best-bid/best-offer
 * feed. Repair for a defect Codex's A-D acceptance review implicitly
 * required (directive: "Do not label Optionomics historical bid/ask as
 * broker-executable BBO"): the prior version of this type was named
 * `HistoricalBboObservationRow`, which reads as broker BBO. A study that
 * needs genuine broker-executable historical BBO must await a canonical
 * Alpaca/Codex export -- this type and the functions built on it can
 * never satisfy that need, regardless of field similarity.
 */
export interface OptionomicsHistoricalQuoteObservationRow {
  readonly observationTimestamp: string;
  readonly sessionDate: string;
  readonly underlying: string;
  readonly contractId: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly isStale: boolean;
}

export type QuoteRowValidityReason = 'VALID' | 'BID_NON_POSITIVE' | 'ASK_LESS_THAN_BID' | 'STALE' | 'MISSING';

export interface SpreadEffectiveCoverageReport {
  readonly rawRowCount: number;
  readonly validRowCount: number;
  readonly invalidRowCounts: Readonly<Record<Exclude<QuoteRowValidityReason, 'VALID'>, number>>;
  readonly distinctSessionDates: number;
  readonly distinctContracts: number;
  readonly effectiveIndependentSnapshots: number;
}

function classifyQuoteRow(row: OptionomicsHistoricalQuoteObservationRow): QuoteRowValidityReason {
  if (row.bid === null || row.ask === null) return 'MISSING';
  if (row.isStale) return 'STALE';
  if (!(row.bid > 0)) return 'BID_NON_POSITIVE';
  if (row.ask < row.bid) return 'ASK_LESS_THAN_BID';
  return 'VALID';
}

/**
 * Coverage report over TRUE Optionomics session-recorded quote rows only
 * -- callers must never pass an OHLC-bar-derived approximation into this
 * function, since this module has no way to detect that at the type
 * level and treating a bar midpoint as a historical quote would be
 * exactly the fabrication the directive prohibits.
 */
export function buildSpreadEffectiveCoverageReport(rows: readonly OptionomicsHistoricalQuoteObservationRow[]): SpreadEffectiveCoverageReport {
  const classifications = rows.map((row) => classifyQuoteRow(row));
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
 * spreadPct = (ask - bid) / midpoint over Optionomics session-recorded
 * research quotes (never broker-executable BBO -- see
 * `OptionomicsHistoricalQuoteObservationRow`), guarded against a
 * near-zero midpoint denominator (reported null, never Infinity/NaN).
 * Only VALID rows (bid > 0, ask >= bid, not stale) are given a defined
 * spreadPct; an invalid row's spreadPct stays null (UNKNOWN), never
 * coerced to zero. `completedSessionsOnlyThrough` is required and applies
 * the same chronological-ordering and same-day/current-session exclusion
 * repair as `computeIvShockResearch`.
 */
export function computeSpreadStressResearch(
  cohortKey: string, rows: readonly OptionomicsHistoricalQuoteObservationRow[], completedSessionsOnlyThrough: string,
): SpreadStressResearchResult {
  const ordered = sortAndFilterToCompletedSessions(rows, completedSessionsOnlyThrough);
  const withSpread = ordered.map((row) => {
    const valid = classifyQuoteRow(row) === 'VALID';
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
