export const command5aRuntimePlanningVersion = 'theta-command5a-runtime-planning-v1' as const;

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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
