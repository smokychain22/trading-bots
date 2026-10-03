// Phase 4: time and clock chaos. Market state is derived only from the broker clock and calendar (never the machine's local wall clock):
// timezone independence, both DST transitions, early close, open/close boundaries, Friday->Monday, expiry boundary, midnight UTC,
// clock skew and broker disagreement.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMarketSessionState, deriveOptionTimeState, evaluateDecisionFreshness, type BrokerCalendarFact, type BrokerClockFact, type SessionStateInput } from '../src/theta/time-aware-state.js';

const session = (date: string, offset: string, closeHour = 16): BrokerCalendarFact => ({ date, open: `${date}T09:30:00${offset}`, close: `${date}T${String(closeHour).padStart(2, '0')}:00:00${offset}` });
const iso = (ms: number): string => new Date(ms).toISOString();
const clockAt = (observedAt: string, calendar: BrokerCalendarFact, nextOpen: string | null = null): BrokerClockFact => {
  const now = Date.parse(observedAt);
  return { timestamp: observedAt, isOpen: now >= Date.parse(calendar.open) && now < Date.parse(calendar.close), nextOpen, nextClose: calendar.close };
};
const receiptAt = (observedAt: string, calendar: BrokerCalendarFact, extra: Partial<SessionStateInput> = {}) =>
  deriveMarketSessionState({ observedAt, clock: clockAt(observedAt, calendar), calendar: [calendar], ...extra });

// regular and DST-boundary sessions: Fri Oct 30 2026 (EDT, -04:00), Mon Nov 2 2026 (EST, -05:00, first Monday after DST ended on Nov 1),
// Fri Mar 6 2026 (EST), Mon Mar 9 2026 (EDT, first Monday after DST began on Mar 8), and the early-close Friday Nov 27 2026 (13:00 ET).
const SESSIONS: ReadonlyArray<readonly [string, BrokerCalendarFact, boolean]> = [
  ['EDT regular', session('2026-10-30', '-04:00'), false], ['first EST Monday', session('2026-11-02', '-05:00'), false],
  ['EST regular', session('2026-03-06', '-05:00'), false], ['first EDT Monday', session('2026-03-09', '-04:00'), false],
  ['early close', session('2026-11-27', '-05:00', 13), true],
];

test('every minute around every session: the open interval is exactly [open, close), state progression is monotone, minutes move the right way', () => {
  const order = ['PREMARKET_CONTEXT', 'OPENING_WINDOW', 'REGULAR_SESSION', 'MID_SESSION', 'LATE_SESSION', 'CLOSING_WINDOW', 'POST_CLOSE'];
  for (const [name, calendar, early] of SESSIONS) {
    const open = Date.parse(calendar.open), close = Date.parse(calendar.close);
    let lastRank = -1, lastFromOpen = -Infinity, lastToClose = Infinity;
    for (let at = open - 90 * 60_000; at <= close + 90 * 60_000; at += 60_000) {
      const receipt = receiptAt(iso(at), calendar);
      const inside = at >= open && at < close;
      const sessionStates = receipt.states.filter((state) => order.includes(state));
      const rank = Math.max(...sessionStates.map((state) => order.indexOf(state)));
      assert.ok(rank >= lastRank, `${name}: state went backwards at ${iso(at)} (${receipt.states.join(',')})`);
      lastRank = rank;
      assert.equal(receipt.states.includes('POST_CLOSE') || receipt.states.includes('PREMARKET_CONTEXT'), !inside, `${name}: closed/open mismatch at ${iso(at)}`);
      assert.equal(receipt.brokerAgreement, 'AGREE', `${name}: clock and calendar must agree at ${iso(at)}`);
      assert.equal(receipt.earlyClose, early, name);
      assert.equal(receipt.sessionDate, calendar.date, `${name}: session date`);
      assert.ok((receipt.minutesFromOpen as number) > lastFromOpen);
      assert.ok((receipt.minutesToClose as number) < lastToClose);
      lastFromOpen = receipt.minutesFromOpen as number; lastToClose = receipt.minutesToClose as number;
    }
    assert.ok(receiptAt(iso(open - 1_000), calendar).states.includes('PREMARKET_CONTEXT'), `${name}: one second before the open`);
    assert.ok(receiptAt(iso(open), calendar).states.includes('OPENING_WINDOW'), `${name}: the open instant belongs to the session`);
    assert.ok(receiptAt(iso(close - 1_000), calendar).states.includes('CLOSING_WINDOW'), `${name}: one second before the close`);
    assert.ok(receiptAt(iso(close), calendar).states.includes('POST_CLOSE'), `${name}: the close instant is already closed`);
  }
});

test('the receipt is independent of the machine local timezone (never the local wall clock)', () => {
  const original = process.env.TZ;
  const calendar = session('2026-11-02', '-05:00');
  const probes = [Date.parse(calendar.open) - 3_600_000, Date.parse(calendar.open), Date.parse(calendar.close) - 1, Date.parse(calendar.close), Date.parse('2026-11-03T00:30:00Z')].map(iso);
  const run = (zone: string) => { process.env.TZ = zone; return probes.map((at) => JSON.stringify(receiptAt(at, calendar))); };
  try {
    const baseline = run('UTC');
    for (const zone of ['America/New_York', 'Asia/Karachi', 'Pacific/Auckland', 'America/Los_Angeles', 'Europe/London']) assert.deepEqual(run(zone), baseline, zone);
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('the session date flips at New York midnight, not at midnight UTC (2026-10-02 23:59:59Z is still the 2026-10-02 evening)', () => {
  const calendar = session('2026-10-02', '-04:00');
  for (const [at, date] of [['2026-10-02T23:59:59Z', '2026-10-02'], ['2026-10-03T00:00:00Z', '2026-10-02'], ['2026-10-03T03:59:59Z', '2026-10-02'], ['2026-10-03T04:00:00Z', '2026-10-03']] as const) {
    assert.equal(deriveMarketSessionState({ observedAt: at, clock: null, calendar: [calendar] }).sessionDate, date, at);
  }
});

test('a weekend is non-trading; Friday evening to Monday morning is exactly the broker-provided gap (never wall-clock arithmetic)', () => {
  const friday = session('2026-10-30', '-04:00');
  const saturday = deriveMarketSessionState({ observedAt: '2026-10-31T15:00:00Z', clock: { timestamp: '2026-10-31T15:00:00Z', isOpen: false, nextOpen: '2026-11-02T14:30:00Z', nextClose: '2026-11-02T21:00:00Z' }, calendar: [friday] });
  assert.ok(saturday.states.includes('WEEKEND_NON_TRADING'));
  assert.equal(saturday.minutesToNextOpen, (Date.parse('2026-11-02T14:30:00Z') - Date.parse('2026-10-31T15:00:00Z')) / 60_000);
  const fridayEvening = deriveMarketSessionState({ observedAt: '2026-10-30T22:00:00Z', clock: { timestamp: '2026-10-30T22:00:00Z', isOpen: false, nextOpen: '2026-11-02T14:30:00Z', nextClose: '2026-11-02T21:00:00Z' }, calendar: [friday] });
  // 2026-11-01 is the end of DST: the weekend is 1 hour longer in wall-clock terms; the UTC arithmetic must still be exact
  assert.equal(fridayEvening.minutesToNextOpen, (Date.parse('2026-11-02T14:30:00Z') - Date.parse('2026-10-30T22:00:00Z')) / 60_000);
  assert.ok(fridayEvening.states.includes('POST_CLOSE'));
});

test('expiry day and the final hour are derived from the session, DTE groups are monotone, invalid DTE is UNKNOWN', () => {
  const calendar = session('2026-10-30', '-04:00');
  const at = (hhmm: string) => `2026-10-30T${hhmm}:00-04:00`;
  const open = receiptAt(at('10:00'), calendar, { expirationDate: '2026-10-30' });
  assert.ok(open.states.includes('EXPIRY_DAY') && !open.states.includes('EXPIRY_FINAL_WINDOW'));
  assert.ok(receiptAt(at('15:00'), calendar, { expirationDate: '2026-10-30' }).states.includes('EXPIRY_FINAL_WINDOW'), 'exactly 60 minutes to close is the final window');
  assert.ok(!receiptAt(at('14:59'), calendar, { expirationDate: '2026-10-30' }).states.includes('EXPIRY_FINAL_WINDOW'));
  assert.ok(!receiptAt(at('10:00'), calendar, { expirationDate: '2026-10-31' }).states.includes('EXPIRY_DAY'));
  const groups = [0, 1, 7, 8, 21, 22, 45, 46, 400].map((dte) => deriveOptionTimeState(dte, open).dteGroup);
  assert.deepEqual(groups, ['ZERO_DTE', 'ONE_TO_SEVEN_DTE', 'ONE_TO_SEVEN_DTE', 'EIGHT_TO_TWENTY_ONE_DTE', 'EIGHT_TO_TWENTY_ONE_DTE', 'TWENTY_TWO_TO_FORTY_FIVE_DTE', 'TWENTY_TWO_TO_FORTY_FIVE_DTE', 'OVER_FORTY_FIVE_DTE', 'OVER_FORTY_FIVE_DTE']);
  for (const bad of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = deriveOptionTimeState(bad, open);
    assert.equal(state.dteGroup, 'UNKNOWN'); assert.equal(state.dte, null); assert.equal(state.timeValueDecayContext, 'UNKNOWN'); assert.equal(state.isExpirationDay, null);
  }
});

test('clock skew, future timestamps and broker disagreement are typed, never silently treated as open or fresh', () => {
  const calendar = session('2026-11-02', '-05:00');
  assert.equal(deriveMarketSessionState({ observedAt: 'not a time', clock: null, calendar: [calendar] }).quality, 'INVALID');
  assert.equal(deriveMarketSessionState({ observedAt: '', clock: null, calendar: [calendar] }).primary, 'UNKNOWN');
  const lying = deriveMarketSessionState({ observedAt: '2026-11-02T10:00:00-05:00', clock: { timestamp: '2026-11-02T10:00:00-05:00', isOpen: false, nextOpen: null, nextClose: null }, calendar: [calendar] });
  assert.equal(lying.brokerAgreement, 'DISAGREE');
  assert.equal(lying.quality, 'DEGRADED');
  assert.ok(lying.reasonCodes.includes('BROKER_CLOCK_CALENDAR_DISAGREE'));
  const noCalendar = deriveMarketSessionState({ observedAt: '2026-11-02T10:00:00-05:00', clock: { timestamp: '2026-11-02T10:00:00-05:00', isOpen: true, nextOpen: null, nextClose: null }, calendar: [] });
  assert.ok(noCalendar.reasonCodes.includes('CALENDAR_SESSION_NOT_FOUND'));
  assert.notEqual(noCalendar.quality, 'GOOD');
  // decision freshness: skew (observed before the decision) is UNKNOWN, expiry is inclusive, unknown required facts invalidate
  const base = { decisionAt: '2026-11-02T15:00:00Z', expiresAt: '2026-11-02T15:10:00Z', changedFacts: [] as string[], requiredFactsUnknown: [] as string[] };
  assert.equal(evaluateDecisionFreshness({ ...base, observedAt: '2026-11-02T14:59:59Z' }).state, 'UNKNOWN');
  assert.equal(evaluateDecisionFreshness({ ...base, observedAt: '2026-11-02T15:09:59Z' }).state, 'FRESH');
  assert.equal(evaluateDecisionFreshness({ ...base, observedAt: '2026-11-02T15:10:00Z' }).state, 'INVALIDATED');
  assert.ok(evaluateDecisionFreshness({ ...base, observedAt: '2026-11-02T15:10:00Z' }).invalidationReasons.includes('DECISION_EXPIRED'));
  assert.equal(evaluateDecisionFreshness({ ...base, observedAt: '2026-11-02T15:01:00Z', requiredFactsUnknown: ['x'] }).state, 'INVALIDATED');
  assert.equal(evaluateDecisionFreshness({ ...base, observedAt: 'garbage' }).state, 'UNKNOWN');
});

test('no production module infers market state from the machine local wall clock', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
  const offenders: string[] = [];
  for (const root of ['src', 'api']) for (const file of walk(root)) {
    if (/\.(getHours|getMinutes|getDay|getDate|getMonth)\(\)|toLocaleTimeString|toLocaleDateString\(\)|getTimezoneOffset/.test(readFileSync(file, 'utf8'))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'local-clock APIs found; use the broker clock/calendar (Intl with an explicit America/New_York zone)');
});
