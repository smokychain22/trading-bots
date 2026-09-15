export const thetaTimeStateVersion = 'theta-time-state-v1' as const;

export type MarketSessionState =
  | 'MARKET_CLOSED' | 'PREMARKET_CONTEXT' | 'OPENING_WINDOW' | 'REGULAR_SESSION'
  | 'MID_SESSION' | 'LATE_SESSION' | 'CLOSING_WINDOW' | 'EXPIRY_DAY'
  | 'EXPIRY_FINAL_WINDOW' | 'POST_CLOSE' | 'WEEKEND_NON_TRADING'
  | 'EARLY_CLOSE_SESSION' | 'EVENT_WINDOW' | 'UNKNOWN';

export interface BrokerClockFact {
  readonly timestamp: string;
  readonly isOpen: boolean;
  readonly nextOpen: string | null;
  readonly nextClose: string | null;
}

export interface BrokerCalendarFact {
  readonly date: string;
  readonly open: string;
  readonly close: string;
}

export interface SessionStateInput {
  readonly observedAt: string;
  readonly clock: BrokerClockFact | null;
  readonly calendar: readonly BrokerCalendarFact[];
  readonly expirationDate?: string | null;
  readonly eventWindowActive?: boolean | null;
}

export interface SessionStateReceipt {
  readonly version: typeof thetaTimeStateVersion;
  readonly primary: MarketSessionState;
  readonly states: readonly MarketSessionState[];
  readonly sessionDate: string | null;
  readonly minutesFromOpen: number | null;
  readonly minutesToClose: number | null;
  readonly minutesToNextOpen: number | null;
  readonly earlyClose: boolean | null;
  readonly brokerAgreement: 'AGREE' | 'DISAGREE' | 'UNKNOWN';
  readonly quality: 'GOOD' | 'DEGRADED' | 'UNKNOWN' | 'INVALID';
  readonly reasonCodes: readonly string[];
}

const parse = (value: string | null | undefined): number | null => {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const newYorkDate = (timestamp: string): string | null => {
  const time = parse(timestamp);
  if (time === null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(time));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const minutes = (later: number, earlier: number): number => (later - earlier) / 60_000;

/**
 * Derives descriptive session context from broker facts. The windows only
 * label evidence. They never authorize an entry, exit, or broker mutation.
 */
export function deriveMarketSessionState(input: SessionStateInput): SessionStateReceipt {
  const now = parse(input.observedAt);
  const reasons: string[] = [];
  if (now === null) return { version: thetaTimeStateVersion, primary: 'UNKNOWN', states: ['UNKNOWN'],
    sessionDate: null, minutesFromOpen: null, minutesToClose: null, minutesToNextOpen: null,
    earlyClose: null, brokerAgreement: 'UNKNOWN', quality: 'INVALID', reasonCodes: ['OBSERVED_AT_INVALID'] };
  const sessionDate = newYorkDate(input.observedAt);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(now));
  const today = input.calendar.find((entry) => entry.date === sessionDate) ?? null;
  const open = today === null ? null : parse(today.open);
  const close = today === null ? null : parse(today.close);
  const clockClose = parse(input.clock?.nextClose);
  const clockOpen = parse(input.clock?.nextOpen);
  const calendarOpen = open !== null && close !== null && now >= open && now < close;
  const activeOpen = today === null ? input.clock?.isOpen === true : calendarOpen;
  const agreement = input.clock === null || open === null || close === null ? 'UNKNOWN'
    : input.clock.isOpen === calendarOpen ? 'AGREE' : 'DISAGREE';
  if (agreement === 'DISAGREE') reasons.push('BROKER_CLOCK_CALENDAR_DISAGREE');
  if (today === null) reasons.push('CALENDAR_SESSION_NOT_FOUND');
  if (input.clock === null) reasons.push('BROKER_CLOCK_MISSING');
  const standardCloseHour = close === null ? null : Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(close)));
  const earlyClose = standardCloseHour === null ? null : standardCloseHour < 16;
  const fromOpen = open === null ? null : minutes(now, open);
  const toClose = close === null ? (clockClose === null ? null : minutes(clockClose, now)) : minutes(close, now);
  const toNextOpen = clockOpen === null ? null : minutes(clockOpen, now);
  const states: MarketSessionState[] = [];
  if (weekday === 'Sat' || weekday === 'Sun') states.push('WEEKEND_NON_TRADING');
  if (input.eventWindowActive === true) states.push('EVENT_WINDOW');
  if (earlyClose === true && activeOpen) states.push('EARLY_CLOSE_SESSION');
  if (input.expirationDate != null && input.expirationDate.slice(0, 10) === sessionDate) {
    states.push('EXPIRY_DAY');
    if (activeOpen && toClose !== null && toClose <= 60) states.push('EXPIRY_FINAL_WINDOW');
  }
  if (activeOpen) {
    if (fromOpen !== null && fromOpen < 30) states.push('OPENING_WINDOW');
    else if (toClose !== null && toClose <= 30) states.push('CLOSING_WINDOW');
    else if (toClose !== null && toClose <= 120) states.push('LATE_SESSION');
    else if (fromOpen !== null && fromOpen >= 120) states.push('MID_SESSION');
    else states.push('REGULAR_SESSION');
  } else if (open !== null && now < open) states.push('PREMARKET_CONTEXT');
  else if (close !== null && now >= close) states.push('POST_CLOSE');
  else if (!states.includes('WEEKEND_NON_TRADING')) states.push('MARKET_CLOSED');
  if (states.length === 0) states.push('UNKNOWN');
  return { version: thetaTimeStateVersion, primary: states[states.length - 1] ?? 'UNKNOWN', states:[...new Set(states)],
    sessionDate, minutesFromOpen:fromOpen, minutesToClose:toClose, minutesToNextOpen:toNextOpen, earlyClose,
    brokerAgreement:agreement, quality:agreement === 'DISAGREE' ? 'DEGRADED' : today !== null && input.clock !== null ? 'GOOD' : 'UNKNOWN',
    reasonCodes:[...new Set(reasons)].sort() };
}

export type DteGroup = 'ZERO_DTE' | 'ONE_TO_SEVEN_DTE' | 'EIGHT_TO_TWENTY_ONE_DTE' |
  'TWENTY_TWO_TO_FORTY_FIVE_DTE' | 'OVER_FORTY_FIVE_DTE' | 'UNKNOWN';

export interface OptionTimeState {
  readonly dte: number | null;
  readonly dteGroup: DteGroup;
  readonly isExpirationDay: boolean | null;
  readonly minutesToSessionClose: number | null;
  readonly timeValueDecayContext: 'NEAR_EXPIRY' | 'STANDARD' | 'UNKNOWN';
}

export function deriveOptionTimeState(dte: number | null, session: SessionStateReceipt): OptionTimeState {
  const valid = dte !== null && Number.isFinite(dte) && dte >= 0;
  const group: DteGroup = !valid ? 'UNKNOWN' : dte === 0 ? 'ZERO_DTE' : dte <= 7 ? 'ONE_TO_SEVEN_DTE'
    : dte <= 21 ? 'EIGHT_TO_TWENTY_ONE_DTE' : dte <= 45 ? 'TWENTY_TWO_TO_FORTY_FIVE_DTE' : 'OVER_FORTY_FIVE_DTE';
  return { dte:valid ? dte : null, dteGroup:group, isExpirationDay:valid ? dte === 0 : null,
    minutesToSessionClose:session.minutesToClose,
    timeValueDecayContext:!valid ? 'UNKNOWN' : dte <= 7 ? 'NEAR_EXPIRY' : 'STANDARD' };
}

export interface DecisionFreshnessReceipt {
  readonly state: 'FRESH' | 'INVALIDATED' | 'UNKNOWN';
  readonly ageMs: number | null;
  readonly invalidationReasons: readonly string[];
}

export function evaluateDecisionFreshness(input: {decisionAt:string; observedAt:string; expiresAt:string|null;
  changedFacts:readonly string[]; requiredFactsUnknown:readonly string[]}): DecisionFreshnessReceipt {
  const decision = parse(input.decisionAt), observed = parse(input.observedAt), expires = parse(input.expiresAt);
  if (decision === null || observed === null || observed < decision) return {state:'UNKNOWN',ageMs:null,
    invalidationReasons:['DECISION_TIME_INVALID']};
  const reasons = [...new Set(input.changedFacts)].sort();
  if (expires !== null && observed >= expires) reasons.push('DECISION_EXPIRED');
  if (input.requiredFactsUnknown.length > 0) reasons.push('REQUIRED_FACT_UNKNOWN');
  return {state:reasons.length > 0 ? 'INVALIDATED' : 'FRESH',ageMs:observed-decision,
    invalidationReasons:[...new Set(reasons)].sort()};
}
