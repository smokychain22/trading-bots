import type { AlpacaCalendarSession } from '../theta/alpaca-provider.js';
import type { StrategyLearningSession } from './strategy-learning-horizon.js';

export const alpacaLearningCalendarVersion = 'theta-alpaca-learning-calendar-v1' as const;
const TIME = /^(\d{2}):(\d{2})$/;

function offsetAt(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (part === undefined) throw new Error('ALPACA_CALENDAR_TIMEZONE_PART_MISSING');
    return Number(part);
  };
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return asUtc - instantMs;
}

export function newYorkSessionTime(date: string, time: string): string {
  const match = TIME.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || match === null) {
    throw new Error('ALPACA_CALENDAR_LOCAL_TIME_INVALID');
  }
  const [year, month, day] = date.split('-').map(Number);
  const hour = Number(match[1]), minute = Number(match[2]);
  if (year === undefined || month === undefined || day === undefined || hour > 23 || minute > 59) {
    throw new Error('ALPACA_CALENDAR_LOCAL_TIME_INVALID');
  }
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wallClockUtc - offsetAt(wallClockUtc);
  instant = wallClockUtc - offsetAt(instant);
  const result = new Date(instant);
  if (!Number.isFinite(result.getTime())) throw new Error('ALPACA_CALENDAR_LOCAL_TIME_INVALID');
  return result.toISOString();
}

export function alpacaCalendarToLearningSessions(
  sessions: readonly AlpacaCalendarSession[],
): readonly StrategyLearningSession[] {
  return sessions.flatMap((session) => session.open === null || session.close === null ? [] : [{
    date: session.date,
    openAt: newYorkSessionTime(session.date, session.open),
    closeAt: newYorkSessionTime(session.date, session.close),
    source: 'ALPACA_CALENDAR' as const,
  }]);
}
