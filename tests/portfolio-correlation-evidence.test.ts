import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPortfolioCorrelation } from '../src/theta/portfolio-correlation-evidence.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const decisionAsOf = '2026-09-23T14:00:00.000Z';
const evaluatedAt = '2026-09-23T14:00:05.000Z';
function bar(symbol: string, day: number, close: number, receivedAt = '2026-09-22T21:00:00.000Z'): HistoricalBar {
  return { symbol, timestamp: `2026-09-${String(day).padStart(2, '0')}T13:30:00.000Z`,
    open: close, high: close, low: close, close, volume: 1000, tradeCount: 10,
    vwap: close, provider: 'ALPACA', feed: 'iex', receivedAt };
}
const base = { candidateUnderlying: 'SPY', decisionAsOf, evaluatedAt,
  providerState: 'COMPLETE' as const, lookbackSessions: 4, minimumOverlappingReturns: 3,
  maxBarAgeCalendarDays: 5 };

test('flat broker portfolio is not applicable, not zero correlation', () => {
  const result = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: {}, bars: [] });
  assert.equal(result.state, 'NOT_APPLICABLE');
  assert.equal(result.maxAbsoluteCorrelation, null);
  assert.equal(result.exposureWeightedCorrelation, null);
  assert.equal(result.usableForDecision, true);
});

test('same-symbol current exposure has identity correlation without inventing a market observation', () => {
  const result = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { SPY: 5000 }, bars: [] });
  assert.equal(result.state, 'KNOWN');
  assert.equal(result.pairs[0]?.correlation, 1);
  assert.equal(result.pairs[0]?.reason, 'SAME_UNDERLYING_IDENTITY');
  assert.equal(result.sourceBarHash, null);
});

test('synchronized completed daily bars produce weighted signed and maximum absolute correlation', () => {
  const bars = [17, 18, 19, 20, 21].flatMap((day, index) => [
    bar('SPY', day, [100, 101, 103, 102, 105][index] as number),
    bar('QQQ', day, [200, 202, 206, 204, 210][index] as number),
    bar('IWM', day, [100, 98, 95, 96, 92][index] as number),
  ]);
  const result = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 3000, IWM: 1000 }, bars });
  assert.equal(result.state, 'KNOWN');
  assert.equal(result.knownPairCoverage, 1);
  assert.ok((result.maxAbsoluteCorrelation ?? 0) > 0.9);
  assert.ok((result.exposureWeightedCorrelation ?? 0) > 0);
  assert.equal(result.usableForDecision, true);
});

test('a later-received bar may be recorded but cannot feed an earlier decision', () => {
  const bars = [17, 18, 19, 20, 21].flatMap((day, index) => [
    bar('SPY', day, 100 + index, '2026-09-23T14:00:04.000Z'),
    bar('QQQ', day, 200 + index * 2, '2026-09-23T14:00:04.000Z'),
  ]);
  const result = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars });
  assert.equal(result.state, 'KNOWN');
  assert.equal(result.usableForDecision, false);
  assert.equal(result.reason, 'OBSERVED_AFTER_DECISION');
});

test('stale, incomplete, and failed provider evidence remain distinct', () => {
  const bars = [1, 2, 3, 4, 5].flatMap((day, index) => [bar('SPY', day, 100 + index), bar('QQQ', day, 200 + index * 2)]);
  const stale = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars });
  assert.equal(stale.state, 'STALE');
  assert.equal(stale.exposureWeightedCorrelation, null);
  const missing = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars: [] });
  assert.equal(missing.state, 'STALE');
  const partial = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars, providerState: 'INCOMPLETE' });
  assert.equal(partial.state, 'PARTIAL_COVERAGE');
  const error = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars, providerState: 'ERROR' });
  assert.equal(error.reason, 'ALPACA_BARS_PROVIDER_ERROR');
});

test('minimum overlap is enforced and a current-day unfinished bar is excluded', () => {
  const bars = [18, 19, 20].flatMap((day, index) => [bar('SPY', day, 100 + index), bar('QQQ', day, 200 + index * 2)]);
  bars.push(bar('SPY', 23, 900), bar('QQQ', 23, 900));
  const result = assessPortfolioCorrelation({ ...base, currentExposureByUnderlying: { QQQ: 1000 }, bars });
  assert.equal(result.state, 'DATA_INSUFFICIENT');
  assert.equal(result.pairs[0]?.overlappingReturns, 2);
  assert.equal(result.pairs[0]?.correlation, null);
});
