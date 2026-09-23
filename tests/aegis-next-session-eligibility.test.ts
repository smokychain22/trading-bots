import assert from 'node:assert/strict';
import test from 'node:test';
import { assessNextSessionHistoryEligibility } from '../src/theta/aegis-next-session-eligibility.js';
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
