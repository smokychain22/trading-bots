import { classifyLocalSpoolWatermark } from '../storage/local-research-archive-health.js';

export const command5aRuntimePlanningVersion = 'theta-command5a-runtime-planning-v2' as const;

export const command5aCalendarLookaheadDays = 21;

export interface Command5aCalendarRangeInput {
  readonly decisionAt: string;
  readonly expirations: readonly string[];
}

export interface Command5aCalendarRange {
  readonly start: string;
  readonly end: string;
  readonly lookaheadDays: number;
}

export type Command5aPageOutcome<T> =
  | { readonly state: 'PROCESSED'; readonly value: T }
  | { readonly state: 'SKIPPED'; readonly reasonCode: string };

export type Command5aPageFailureDisposition = 'TERMINAL_IMMUTABLE_SKIP' | 'RETRY_REQUIRED';

const terminalImmutablePageFailures = new Set([
  'FRONTIER_ARCHIVE_MISSING',
  'FRONTIER_ARCHIVE_INVALID',
  'FRONTIER_TIMESTAMP_INVALID',
  'RELEASE_IDENTITY_MISSING',
  'DECISION_ID_MISSING',
  'UNDERLYING_IDENTITY_AMBIGUOUS',
]);

/** Only immutable source defects may be crossed by the durable cursor. Local
 * SQLite, filesystem, and unknown runtime failures must be retried instead of
 * becoming a permanently skipped frontier. */
export function command5aPageFailureDisposition(reasonCode: string): Command5aPageFailureDisposition {
  return terminalImmutablePageFailures.has(reasonCode) ? 'TERMINAL_IMMUTABLE_SKIP' : 'RETRY_REQUIRED';
}

export function lastSafeCommand5aPageIndex<T>(outcomes: readonly Command5aPageOutcome<T>[]): number {
  const firstRetryRequiredIndex = outcomes.findIndex((outcome) => outcome.state === 'SKIPPED'
    && command5aPageFailureDisposition(outcome.reasonCode) === 'RETRY_REQUIRED');
  return firstRetryRequiredIndex === -1 ? outcomes.length - 1 : firstRetryRequiredIndex - 1;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Command5aSchedulingStoragePressure {
  readonly activeSpoolBytes: number;
  readonly totalLocalResearchBytes: number;
  readonly spoolWatermark: ReturnType<typeof classifyLocalSpoolWatermark>;
}

/** Immutable Parquet is the successful destination of compacted research
 * history. It stays in total inventory telemetry, but it cannot consume the
 * mutable SQLite scheduling budget and permanently stop future observation. */
export function classifyCommand5aSchedulingStorage(input: {
  readonly schedulerBytes: number;
  readonly spoolBytes: number;
  readonly parquetBytes: number;
}): Command5aSchedulingStoragePressure {
  for (const value of [input.schedulerBytes, input.spoolBytes, input.parquetBytes]) {
    if (!Number.isInteger(value) || value < 0) throw new Error('COMMAND5A_STORAGE_BYTES_INVALID');
  }
  const activeSpoolBytes = input.schedulerBytes + input.spoolBytes;
  return {
    activeSpoolBytes,
    totalLocalResearchBytes: activeSpoolBytes + input.parquetBytes,
    spoolWatermark: classifyLocalSpoolWatermark(activeSpoolBytes),
  };
}

function dateOnly(value: string): string | null {
  const date = value.slice(0, 10);
  return DATE.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ? date : null;
}

/**
 * Calendar coverage must include the five-trading-day learning horizon even
 * when a short-DTE option expires first. The extra calendar window is only a
 * query bound. Actual targets still come from Alpaca's exchange sessions.
 */
export function buildCommand5aCalendarRange(
  inputs: readonly Command5aCalendarRangeInput[],
): Command5aCalendarRange | null {
  const decisionDates = inputs.map((input) => dateOnly(input.decisionAt))
    .filter((value): value is string => value !== null);
  if (decisionDates.length === 0) return null;
  const expirationDates = inputs.flatMap((input) => input.expirations)
    .map(dateOnly).filter((value): value is string => value !== null);
  const start = [...decisionDates].sort()[0];
  const latestDecision = [...decisionDates].sort().at(-1);
  if (start === undefined || latestDecision === undefined) return null;
  const lookaheadEnd = new Date(Date.parse(`${latestDecision}T00:00:00.000Z`)
    + command5aCalendarLookaheadDays * 86_400_000).toISOString().slice(0, 10);
  const end = [...expirationDates, lookaheadEnd].sort().at(-1) ?? lookaheadEnd;
  return { start, end, lookaheadDays: command5aCalendarLookaheadDays };
}

export function command5aSafeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = message.split(':', 1)[0] ?? '';
  return /^[A-Z][A-Z0-9_]{2,160}$/.test(code) ? code : 'COMMAND5A_UNCLASSIFIED_FAILURE';
}

/**
 * One corrupt immutable frontier must remain visible without preventing later
 * frontiers in the bounded source page from being scheduled. The caller owns
 * cursor advancement after every outcome has been recorded.
 */
export function processCommand5aPage<T, R>(
  items: readonly T[],
  process: (item: T) => R,
): readonly Command5aPageOutcome<R>[] {
  return items.map((item) => {
    try {
      return { state: 'PROCESSED', value: process(item) } as const;
    } catch (error) {
      return { state: 'SKIPPED', reasonCode: command5aSafeFailureCode(error) } as const;
    }
  });
}
