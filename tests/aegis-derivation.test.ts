import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAegisGapStress, deriveCandidateMarketQuality, deriveExecutionQualityAcceptable, deriveLiquidityAcceptable, deriveProviderState, deriveStressGapDetected } from '../src/theta/aegis-derivation.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const NOW = '2026-09-10T15:00:00.000Z';

const contract = (overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract =>
  normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261009P00500000', occSymbol: 'SPY261009P00500000',
    optionType: 'PUT', strike: 500, expiration: '2026-10-09', asOfDate: '2026-09-10', multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: 4.5, ask: 4.7, bidSize: 10, askSize: 12, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: NOW, tradeTimestamp: null,
    volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: null, greeksSource: null,
    feed: 'INDICATIVE', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15,
    ...overrides,
  }, NOW);

test('deriveProviderState maps all-GOOD required capabilities to OK', () => {
  assert.equal(deriveProviderState(['GOOD', 'GOOD', 'GOOD']), 'OK');
  assert.equal(deriveProviderState([]), null);
});

test('deriveProviderState maps any INVALID/NOT_ENTITLED capability to the literal string INVALID (matching aegis.py exact-check)', () => {
  assert.equal(deriveProviderState(['GOOD', 'INVALID', 'GOOD']), 'INVALID');
  assert.equal(deriveProviderState(['GOOD', 'NOT_ENTITLED']), 'INVALID');
});

test('deriveProviderState maps a merely degraded/stale/unknown mix (no INVALID) to null (genuine UNKNOWN), never OK or a fabricated failure', () => {
  assert.equal(deriveProviderState(['GOOD', 'STALE']), null);
  assert.equal(deriveProviderState(['DEGRADED', 'UNKNOWN']), null);
});

test('deriveLiquidityAcceptable is true when at least one candidate has an acceptable spread', () => {
  const tight = contract({ bid: 4.5, ask: 4.55 }); // ~1.1% spread
  const wide = contract({ bid: 4.0, ask: 5.0 }); // ~22% spread
  assert.equal(deriveLiquidityAcceptable([wide, tight], 0.15), true);
});

test('deriveLiquidityAcceptable is false only when every known spread exceeds the floor', () => {
  const wide1 = contract({ bid: 4.0, ask: 5.0 });
  const wide2 = contract({ bid: 3.0, ask: 4.0 });
  assert.equal(deriveLiquidityAcceptable([wide1, wide2], 0.15), false);
});

test('deriveLiquidityAcceptable is UNKNOWN (null) when there is nothing to judge', () => {
  assert.equal(deriveLiquidityAcceptable([], 0.15), null);
  const unknownSpread = contract({ bid: null, ask: null });
  assert.equal(deriveLiquidityAcceptable([unknownSpread], 0.15), null);
});

test('deriveExecutionQualityAcceptable is true when at least one candidate is genuinely executable', () => {
  const executable = contract({ feed: 'OPRA', bid: 4.5, ask: 4.6, quoteTimestamp: NOW, dataQuality: 'GOOD' });
  assert.equal(deriveExecutionQualityAcceptable([executable]), true);
  assert.equal(deriveExecutionQualityAcceptable([contract()]), true);
});

test('deriveExecutionQualityAcceptable distinguishes an observed failure from missing evidence', () => {
  const unknown = contract({ bid: null, ask: null });
  const observedWideSpread = contract({ bid: 3, ask: 5 });
  assert.equal(deriveExecutionQualityAcceptable([unknown]), null);
  assert.equal(deriveExecutionQualityAcceptable([observedWideSpread]), false);
  assert.equal(deriveExecutionQualityAcceptable([]), null);
});

test('candidate A cannot lend good execution evidence to wide or unknown candidate B', () => {
  const good = contract({ bid: 4.5, ask: 4.55 });
  const wide = contract({ bid: 3, ask: 5 });
  const missing = contract({ bid: null, ask: null });
  assert.equal(deriveExecutionQualityAcceptable([good, wide]), true);
  assert.deepEqual(deriveCandidateMarketQuality(good, 0.15), {
    liquidityAcceptable: true, executionQualityAcceptable: true,
  });
  assert.deepEqual(deriveCandidateMarketQuality(wide, 0.15), {
    liquidityAcceptable: false, executionQualityAcceptable: false,
  });
  assert.deepEqual(deriveCandidateMarketQuality(missing, 0.15), {
    liquidityAcceptable: null, executionQualityAcceptable: null,
  });
});

test('deriveStressGapDetected preserves UNKNOWN when return history is unavailable', () => {
  assert.equal(deriveStressGapDetected(null, 0.05), null);
  assert.equal(deriveStressGapDetected(0.02, 0.05), false);
  assert.equal(deriveStressGapDetected(-0.08, 0.05), true);
  assert.equal(deriveStressGapDetected(0.08, 0.05), true);
});

test('gap stress uses the observed current open and a prior completed close, never a partial current close', () => {
  const bar = (timestamp: string, open: number, close: number): HistoricalBar => ({
    symbol: 'SPY', timestamp, open, high: Math.max(open, close), low: Math.min(open, close), close,
    volume: 1000, tradeCount: null, vwap: null, provider: 'ALPACA', feed: 'iex', receivedAt: NOW,
  });
  const policy = { policyVersion: 'aegis-gap-paper-bootstrap-v1',
    authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL', absoluteReturnThreshold: 0.05,
    returnHorizon: 'CURRENT_SESSION_OPEN_VS_PREVIOUS_COMPLETED_CLOSE',
    barSource: 'ALPACA_1DAY_SPLIT_ADJUSTED_IEX', barUnit: 'DECIMAL_RETURN', requiredCompletedSessions: 1,
    maxPreviousBarAgeDays: 5, sessionCalendarAuthority: 'ALPACA_CLOCK_AND_CURRENT_CALENDAR' } as const;
  const previous = bar('2026-09-09T04:00:00.000Z', 101, 100);
  const today = bar('2026-09-10T04:00:00.000Z', 106, 90);
  const input = { bars: [previous, today], decisionAsOf: NOW, currentSession: '2026-09-10',
    currentSessionConfirmed: true, policy };
  const ready = assessAegisGapStress(input);
  assert.equal(ready.stressGapDetected, true);
  assert.equal(ready.gapReturn, 0.06);
  assert.equal(assessAegisGapStress({ ...input, bars: [previous] }).stressGapDetected, null);
  assert.equal(assessAegisGapStress({ ...input, currentSessionConfirmed: false }).stressGapDetected, null);
  assert.equal(assessAegisGapStress({ ...input,
    bars: [previous, { ...today, timestamp: '2026-09-10T16:00:00.000Z' }] }).stressGapDetected, null);
});
