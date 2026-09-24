import assert from 'node:assert/strict';
import test from 'node:test';
import { assessNextSessionHistoryEligibility,
  selectAegisEligibilitySession } from '../src/theta/aegis-next-session-eligibility.js';
import type { AlpacaContractIvHistoryRow } from '../src/theta/aegis-alpaca-iv-stress.js';
import type { SpreadHistoryObservation } from '../src/theta/aegis-spread-stress.js';

const cohort = { underlying: 'SPY', optionType: 'PUT' as const, feed: 'INDICATIVE' as const,
  dteBucket: 'DTE_22_45', moneynessBucket: 'ATM_0_3PCT' };
const ivRow = (session: string, symbol = 'SPY260101P00600000'): AlpacaContractIvHistoryRow => ({
  evidenceId: `${session}:${symbol}`, sourceHash: 'a'.repeat(64), underlying: 'SPY', optionType: 'PUT',
  optionSymbol: symbol, dte: 30, moneyness: 0.01, iv: 0.2, feed: 'INDICATIVE',
  quoteTimestamp: `${session}T14:00:00.000Z`, ivAvailableAt: `${session}T14:00:01.000Z`,
  decisionTime: `${session}T14:00:02.000Z`,
});
const spreadRow = (session: string): SpreadHistoryObservation => ({
  evidenceId: session, underlying: 'SPY', optionType: 'PUT', contractSymbol: 'SPY260101P00600000',
  dte: 30, moneyness: 0.01, relativeSpread: 0.05, providerTimestamp: `${session}T14:00:00.000Z`,
  ingestionTimestamp: `${session}T14:00:01.000Z`, decisionTime: `${session}T14:00:02.000Z`,
  source: 'ALPACA', feed: 'INDICATIVE', dataQuality: 'GOOD',
});

const calendar = [
  { date: '2026-09-24', open: '09:30', close: '16:00', sessionOpen: null, sessionClose: null },
  { date: '2026-09-25', open: '09:30', close: '16:00', sessionOpen: null, sessionClose: null },
];

test('before-open eligibility uses Alpaca next_open instead of skipping the same-day session', () => {
  assert.deepEqual(selectAegisEligibilitySession({ calendar, clock: {
    timestamp: '2026-09-24T03:45:00-04:00', isOpen: false,
    nextOpen: '2026-09-24T09:30:00-04:00', nextClose: '2026-09-24T16:00:00-04:00',
    receivedAt: '2026-09-24T07:45:00.000Z',
  } }), { session: '2026-09-24', state: 'NEXT_OPEN_SESSION' });
});

test('open-session eligibility uses the current Alpaca exchange session', () => {
  assert.deepEqual(selectAegisEligibilitySession({ calendar, clock: {
    timestamp: '2026-09-24T10:15:00-04:00', isOpen: true,
    nextOpen: '2026-09-25T09:30:00-04:00', nextClose: '2026-09-24T16:00:00-04:00',
    receivedAt: '2026-09-24T14:15:00.000Z',
  } }), { session: '2026-09-24', state: 'CURRENT_OPEN_SESSION' });
});

test('after-close eligibility advances to Alpaca next_open and requires calendar agreement', () => {
  const clock = { timestamp: '2026-09-24T17:00:00-04:00', isOpen: false,
    nextOpen: '2026-09-25T09:30:00-04:00', nextClose: '2026-09-25T16:00:00-04:00',
    receivedAt: '2026-09-24T21:00:00.000Z' };
  assert.deepEqual(selectAegisEligibilitySession({ calendar, clock }),
    { session: '2026-09-25', state: 'NEXT_OPEN_SESSION' });
  assert.throws(() => selectAegisEligibilitySession({ calendar: calendar.slice(0, 1), clock }),
    /ALPACA_CLOCK_CALENDAR_SESSION_MISMATCH/);
});

test('same-day repeated IV scans do not become independent sessions', () => {
  const result = assessNextSessionHistoryEligibility({ nextSession: '2026-09-24', cohort,
    ivHistory: [ivRow('2026-09-23'), ivRow('2026-09-23')], spreadHistory: [spreadRow('2026-09-23')] });
  assert.equal(result.iv.rawN, 1);
  assert.equal(result.iv.sessionN, 1);
  assert.deepEqual(result.iv.missing, ['MINIMUM_RAW_OBSERVATIONS', 'MINIMUM_DISTINCT_SESSIONS']);
  assert.equal(result.spread.sessionN, 1);
  assert.equal(result.stressAssessmentAvailable, false);
});

test('feed and cohort mismatches cannot qualify next-session history', () => {
  const result = assessNextSessionHistoryEligibility({ nextSession: '2026-09-24', cohort,
    ivHistory: [{ ...ivRow('2026-09-23'), feed: 'OPRA' }],
    spreadHistory: [{ ...spreadRow('2026-09-23'), dte: 3 }] });
  assert.equal(result.iv.rawN, 0);
  assert.equal(result.spread.rawN, 0);
});

test('invalid requested sessions fail locally rather than falling back to another date', () => {
  assert.throws(() => assessNextSessionHistoryEligibility({ nextSession: '2026-02-30', cohort,
    ivHistory: [], spreadHistory: [] }), /NEXT_SESSION_INVALID/);
});

test('late backfilled provider sessions cannot create a mature ingestion span', () => {
  const sessions = ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'];
  const result = assessNextSessionHistoryEligibility({ nextSession: '2026-09-24', cohort,
    ivHistory: [], spreadHistory: sessions.flatMap((session) => Array.from({ length: 4 }, (_, index) => ({
      ...spreadRow(session), evidenceId: `${session}:${index}`,
      ingestionTimestamp: `2026-09-23T14:00:0${index}.000Z`,
    }))) });
  assert.equal(result.spread.sessionN, 5);
  assert.equal(result.spread.providerSessionSpanDays, 6);
  assert.ok(result.spread.ingestionTemporalSpanDays < 1);
  assert.deepEqual(result.spread.missing, ['MINIMUM_TEMPORAL_SPAN']);
});
