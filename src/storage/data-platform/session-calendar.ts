// The supported trading-session calendar used to decide which partitions must exist ahead of time. The authority is the PROVIDER calendar (Alpaca /v2/calendar through the
// read-only broker surface), never a local weekday/holiday assumption. Writers key rows by the New York calendar date of the decision instant, and a cycle can run on any
// date (a closed-market diagnostic run, a holiday), so partitions are created for EVERY calendar date from today through the Nth supported future session. When the provider is
// unavailable the plan degrades to a calendar-day superset (cheap: an empty partition costs nothing) and says so; it never falls back to a guessed holiday list.
export interface SessionCalendar {
  /** supported trading sessions (YYYY-MM-DD) with start <= date <= end; throws or rejects when the provider is unavailable */
  sessionsBetween(start: string, end: string): Promise<readonly string[]>;
}

export const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
export const addDays = (date: string, days: number): string => isoDate(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000));

export function brokerSessionCalendar(getCalendar: (start: string, end: string) => Promise<readonly { readonly date: string }[]>): SessionCalendar {
  return { async sessionsBetween(start, end) { return (await getCalendar(start, end)).map((session) => session.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort(); } };
}

export interface PartitionPlan {
  /** every partition date that must exist (calendar days, today through the last planned session) */
  readonly dates: readonly string[];
  readonly source: 'PROVIDER_CALENDAR' | 'CALENDAR_UNAVAILABLE_SUPERSET';
  /** the supported sessions inside the horizon when the provider answered */
  readonly sessions: readonly string[];
  readonly horizonEnd: string;
}

/** `sessionsAhead` supported sessions beyond today are covered; the superset fallback covers `fallbackDays` calendar days. */
export async function planFuturePartitions(calendar: SessionCalendar | null, today: string, sessionsAhead = 7, fallbackDays = 14): Promise<PartitionPlan> {
  const calendarWindowDays = Math.max(fallbackDays, sessionsAhead * 3);
  if (calendar !== null) {
    try {
      const sessions = (await calendar.sessionsBetween(today, addDays(today, calendarWindowDays))).filter((date) => date >= today);
      const last = sessions[Math.min(sessions.length, sessionsAhead + 1) - 1];
      if (last !== undefined && sessions.length >= Math.min(sessionsAhead, 3)) {
        const dates: string[] = []; for (let date = today; date <= last; date = addDays(date, 1)) dates.push(date);
        return { dates, source: 'PROVIDER_CALENDAR', sessions: sessions.slice(0, sessionsAhead + 1), horizonEnd: last };
      }
    } catch { /* provider unavailable: fall through to the superset */ }
  }
  const dates: string[] = []; for (let offset = 0; offset <= fallbackDays; offset += 1) dates.push(addDays(today, offset));
  return { dates, source: 'CALENDAR_UNAVAILABLE_SUPERSET', sessions: [], horizonEnd: dates[dates.length - 1] as string };
}

/** Sessions elapsed between two dates according to the provider calendar (used for archive lag); null when it can not be determined. */
export async function sessionsBetweenCount(calendar: SessionCalendar | null, from: string, to: string): Promise<number | null> {
  if (calendar === null || from > to) return from > to ? 0 : null;
  try { return (await calendar.sessionsBetween(from, to)).filter((date) => date > from && date <= to).length; } catch { return null; }
}
