import { deriveMarketSessionState, type BrokerCalendarFact, type BrokerClockFact,
  type MarketSessionState } from '../theta/time-aware-state.js';

export const premarketSessionSimulatorVersion = 'theta-premarket-session-simulator-v1' as const;

export interface SessionSimulationCase {
  readonly caseId: string;
  readonly observedAt: string;
  readonly calendar: readonly BrokerCalendarFact[];
  readonly clock: BrokerClockFact | null;
  readonly expirationDate?: string;
  readonly expectedStates: readonly MarketSessionState[];
}

const regularCalendar: readonly BrokerCalendarFact[] = [
  { date: '2026-09-24', open: '2026-09-24T13:30:00.000Z', close: '2026-09-24T20:00:00.000Z' },
];
const clock = (timestamp: string, isOpen: boolean, nextOpen: string | null, nextClose: string | null): BrokerClockFact =>
  ({ timestamp, isOpen, nextOpen, nextClose });

export const sessionSimulationCases: readonly SessionSimulationCase[] = [
  { caseId: 'PREMARKET', observedAt: '2026-09-24T13:00:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T13:00:00.000Z', false, '2026-09-24T13:30:00.000Z', '2026-09-24T20:00:00.000Z'),
    expectedStates: ['PREMARKET_CONTEXT'] },
  { caseId: 'OPEN', observedAt: '2026-09-24T13:30:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T13:30:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['OPENING_WINDOW'] },
  { caseId: 'FIRST_5_MINUTES', observedAt: '2026-09-24T13:34:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T13:34:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['OPENING_WINDOW'] },
  { caseId: 'POST_OPEN', observedAt: '2026-09-24T14:10:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T14:10:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['REGULAR_SESSION'] },
  { caseId: 'MIDDAY', observedAt: '2026-09-24T16:30:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T16:30:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['MID_SESSION'] },
  { caseId: 'LATE_SESSION', observedAt: '2026-09-24T18:30:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T18:30:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['LATE_SESSION'] },
  { caseId: 'LAST_30_MINUTES', observedAt: '2026-09-24T19:45:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T19:45:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expectedStates: ['CLOSING_WINDOW'] },
  { caseId: 'EXPIRATION_WINDOW', observedAt: '2026-09-24T19:30:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T19:30:00.000Z', true, null, '2026-09-24T20:00:00.000Z'), expirationDate: '2026-09-24',
    expectedStates: ['EXPIRY_DAY', 'EXPIRY_FINAL_WINDOW', 'CLOSING_WINDOW'] },
  { caseId: 'CLOSE', observedAt: '2026-09-24T20:00:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T20:00:00.000Z', false, '2026-09-25T13:30:00.000Z', null), expectedStates: ['POST_CLOSE'] },
  { caseId: 'POST_CLOSE', observedAt: '2026-09-24T22:00:00.000Z', calendar: regularCalendar,
    clock: clock('2026-09-24T22:00:00.000Z', false, '2026-09-25T13:30:00.000Z', null), expectedStates: ['POST_CLOSE'] },
  { caseId: 'EARLY_CLOSE', observedAt: '2026-11-27T17:45:00.000Z',
    calendar: [{ date: '2026-11-27', open: '2026-11-27T14:30:00.000Z', close: '2026-11-27T18:00:00.000Z' }],
    clock: clock('2026-11-27T17:45:00.000Z', true, null, '2026-11-27T18:00:00.000Z'),
    expectedStates: ['EARLY_CLOSE_SESSION', 'CLOSING_WINDOW'] },
  { caseId: 'HOLIDAY', observedAt: '2026-12-25T16:00:00.000Z', calendar: [],
    clock: clock('2026-12-25T16:00:00.000Z', false, '2026-12-28T14:30:00.000Z', null), expectedStates: ['MARKET_CLOSED'] },
  { caseId: 'WEEKEND', observedAt: '2026-09-26T16:00:00.000Z', calendar: [],
    clock: clock('2026-09-26T16:00:00.000Z', false, '2026-09-28T13:30:00.000Z', null), expectedStates: ['WEEKEND_NON_TRADING'] },
  { caseId: 'DST_TRANSITION', observedAt: '2026-11-02T14:31:00.000Z',
    calendar: [{ date: '2026-11-02', open: '2026-11-02T14:30:00.000Z', close: '2026-11-02T21:00:00.000Z' }],
    clock: clock('2026-11-02T14:31:00.000Z', true, null, '2026-11-02T21:00:00.000Z'), expectedStates: ['OPENING_WINDOW'] },
] as const;

export function runSessionSimulation(): { readonly total: number; readonly pass: number; readonly failures: readonly string[] } {
  const failures: string[] = [];
  for (const scenario of sessionSimulationCases) {
    const receipt = deriveMarketSessionState(scenario);
    for (const expected of scenario.expectedStates) {
      if (!receipt.states.includes(expected)) failures.push(`${scenario.caseId}:MISSING_${expected}`);
    }
    if (scenario.calendar.length > 0 && receipt.brokerAgreement !== 'AGREE') {
      failures.push(`${scenario.caseId}:BROKER_CALENDAR_${receipt.brokerAgreement}`);
    }
  }
  return { total: sessionSimulationCases.length, pass: sessionSimulationCases.length - new Set(
    failures.map((failure) => failure.split(':')[0]),
  ).size, failures };
}
