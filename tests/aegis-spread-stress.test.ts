import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAegisSpreadStress,
  assessAegisSpreadStressForContracts,
  type AegisSpreadStressPolicy,
  type SpreadHistoryObservation,
} from '../src/theta/aegis-spread-stress.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';

const policy: AegisSpreadStressPolicy = {
  policyVersion: 'aegis-spread-widening-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  lookbackDays: 120,
  maximumBaselineObservations: 500,
  minimumRelativeIncrease: 0.5,
  minimumRobustZ: 3,
  maturity: {
    policyVersion: 'aegis-spread-baseline-paper-bootstrap-v1', minimumRawN: 20, minimumSessionN: 5,
    minimumDistinctUnderlyingN: 1, minimumTemporalSpanDays: 4, maxCurrentObservationAgeSeconds: 30,
  },
};

function current(bid = 0.85, ask = 1.15, overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract {
  const value = normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261016P00500000', occSymbol: 'SPY261016P00500000',
    optionType: 'PUT', strike: 520, expiration: '2026-10-16', asOfDate: '2026-09-22', multiplier: 100,
    underlyingBid: 550, underlyingAsk: 550.02, underlyingLast: 550.01, underlyingTimestamp: '2026-09-22T13:59:49.000Z',
    bid, ask, bidSize: 10, askSize: 12, lastTradePrice: 1, lastTradeSize: 1,
    quoteTimestamp: '2026-09-22T13:59:50.000Z', tradeTimestamp: '2026-09-22T13:59:40.000Z',
    volume: 100, volumeSource: 'ALPACA', openInterest: 500, openInterestSource: 'ALPACA',
    iv: 0.2, delta: -0.2, gamma: 0.01, theta: -0.02, vega: 0.05, rho: -0.01,
    greeksTimestamp: '2026-09-22T13:59:50.000Z', greeksSource: 'ALPACA', feed: 'INDICATIVE', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5,
  }, '2026-09-22T13:59:55.000Z');
  return { ...value, ...overrides };
}

function history(relativeSpread = 0.1): readonly SpreadHistoryObservation[] {
  return Array.from({ length: 20 }, (_, index) => {
    const day = 1 + Math.floor(index / 4);
    const date = `2026-09-${String(day).padStart(2, '0')}`;
    return {
      evidenceId: `candidate-${index}:quote-${index}`, underlying: 'SPY', optionType: 'PUT' as const,
      contractSymbol: `SPY-HISTORY-${index}`, dte: 30, moneyness: 0.05,
      relativeSpread: relativeSpread + (index % 3) * 0.002,
      providerTimestamp: `${date}T14:00:00.000Z`, ingestionTimestamp: `${date}T14:00:01.000Z`,
      decisionTime: `${date}T14:00:02.000Z`, source: 'ALPACA' as const, feed: 'INDICATIVE' as const,
      dataQuality: 'GOOD' as const,
    };
  });
}

test('mature same-cohort Alpaca history produces a real spread-widening boolean', () => {
  const assessment = assessAegisSpreadStress({ current: current(), history: history(),
    decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(assessment.maturity.state, 'DETECTOR_READY');
  assert.equal(assessment.maturity.evidence.rawN, 20);
  assert.equal(assessment.maturity.evidence.sessionN, 5);
  assert.equal(assessment.stressSpreadWideningDetected, true);
  assert.equal(assessment.evidenceAuthority, 'ALPACA_EXECUTABLE_MARKET');
});

test('immature or wrong-cohort history remains null rather than false', () => {
  const immature = assessAegisSpreadStress({ current: current(0.94, 1.06), history: history().slice(0, 4),
    decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(immature.maturity.state, 'BASELINE_ACCUMULATING');
  assert.equal(immature.stressSpreadWideningDetected, null);
  const wrongCohort = history().map((row) => ({ ...row, dte: 5 }));
  const absent = assessAegisSpreadStress({ current: current(), history: wrongCohort,
    decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(absent.maturity.state, 'BASELINE_NOT_STARTED');
  assert.equal(absent.stressSpreadWideningDetected, null);
});

test('stale or invalid current BBO cannot emit a no-stress value', () => {
  const stale = assessAegisSpreadStress({ current: current(0.94, 1.06, { quoteTimestamp: '2026-09-22T13:00:00.000Z' }),
    history: history(), decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(stale.maturity.state, 'CURRENT_OBSERVATION_STALE');
  assert.equal(stale.stressSpreadWideningDetected, null);
  const expired = assessAegisSpreadStress({ current: current(0.94, 1.06, { dte: 0 }), history: history(),
    decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(expired.dteBucket, 'DTE_INVALID');
  assert.equal(expired.stressSpreadWideningDetected, null);
});

test('future received evidence is rejected', () => {
  assert.throws(() => assessAegisSpreadStress({ current: current(0.9, 1.1, { receivedAt: '2026-09-22T14:00:01.000Z' }),
    history: history(), decisionAsOf: '2026-09-22T14:00:00.000Z', policy }), /CURRENT_EVIDENCE_FROM_FUTURE/);
});

test('contract assessor loads persisted history once per underlying and option type', async () => {
  let calls = 0;
  const pool = { query: async () => {
    calls++;
    return { rows: history().map((row) => ({ candidate_id: row.evidenceId.split(':')[0], quote_content_hash: 'a'.repeat(64),
      contract_symbol: row.contractSymbol, dte: row.dte, moneyness: row.moneyness, relative_spread: row.relativeSpread,
      provider_timestamp: row.providerTimestamp, ingestion_timestamp: row.ingestionTimestamp,
      decision_time: row.decisionTime, source: row.source, feed: row.feed, data_quality: row.dataQuality })) };
  } };
  const assessments = await assessAegisSpreadStressForContracts({ pool: pool as never,
    contracts: [current(), current(0.9, 1.1, { optionSymbol: 'SPY261016P00490000' })],
    decisionAsOf: '2026-09-22T14:00:00.000Z', policy });
  assert.equal(calls, 1);
  assert.equal(Object.keys(assessments).length, 2);
});
