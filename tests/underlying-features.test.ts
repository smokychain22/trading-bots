import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCurrentDrawdown,
  computeDownsideVolatility,
  computeGapFrequency,
  computeMaxAdverseGap,
  computeRealizedVolatility,
  computeReturn,
  computeTrendSlope,
} from '../src/theta/underlying-features.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const day = (n: number): string => new Date(Date.UTC(2026, 0, n)).toISOString();

const bar = (n: number, open: number, close: number): HistoricalBar => ({
  symbol: 'SPY', timestamp: day(n), open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5,
  close, volume: 1000, tradeCount: 10, vwap: close, provider: 'ALPACA', feed: 'iex', receivedAt: day(n),
});

// A 70-day rising series with one deliberate OVERNIGHT gap-down at day 50:
// day 50's open is well below day 49's close (a real gap, not merely an
// intraday drop within one bar), so gap-detection functions (which compare
// consecutive closes/opens) can actually observe it.
const makeBars = (): HistoricalBar[] => {
  const bars: HistoricalBar[] = [];
  let prevClose = 100;
  for (let n = 1; n <= 70; n += 1) {
    const open = n === 50 ? prevClose - 10 : prevClose; // overnight gap-down at day 50
    const close = open + 0.2;
    bars.push(bar(n, open, close));
    prevClose = close;
  }
  return bars;
};

test('computeReturn computes a simple close-to-close return over the lookback window', () => {
  const bars = makeBars();
  const asOf = day(70);
  const result = computeReturn(bars, asOf, 5);
  assert.ok(result !== null);
  assert.ok(typeof result === 'number');
});

test('computeReturn is null (UNKNOWN) when there are not enough bars for the lookback', () => {
  const bars = makeBars().slice(0, 3);
  const result = computeReturn(bars, day(3), 10);
  assert.equal(result, null);
});

test('computeRealizedVolatility returns a positive annualized figure over a real window', () => {
  const bars = makeBars();
  const result = computeRealizedVolatility(bars, day(70), 20);
  assert.ok(result !== null && result > 0);
});

test('computeDownsideVolatility returns 0 (a real zero) when every move is non-negative, never UNKNOWN', () => {
  const flatUp: HistoricalBar[] = [];
  let price = 100;
  for (let n = 1; n <= 30; n += 1) {
    flatUp.push(bar(n, price, price + 0.5));
    price += 0.5;
  }
  const result = computeDownsideVolatility(flatUp, day(30), 20);
  assert.equal(result, 0);
});

test('computeCurrentDrawdown reflects the drop after the gap day and is negative', () => {
  const bars = makeBars();
  const result = computeCurrentDrawdown(bars, day(70), 60);
  assert.ok(result !== null && result < 0);
});

test('computeTrendSlope is positive for a rising series (excluding the gap window)', () => {
  const bars = makeBars().slice(0, 40); // before the day-50 gap
  const result = computeTrendSlope(bars, day(40), 20);
  assert.ok(result !== null && result > 0);
});

test('computeGapFrequency detects the deliberate day-50 gap-down within its window', () => {
  const bars = makeBars();
  const result = computeGapFrequency(bars, day(70), 60, 0.02);
  assert.ok(result !== null && result > 0);
});

test('computeMaxAdverseGap reports a positive magnitude for the deliberate gap-down', () => {
  const bars = makeBars();
  const result = computeMaxAdverseGap(bars, day(70), 60);
  assert.ok(result !== null && result > 0.05); // the day-50 gap is roughly -10/~110 ~= -9%
});

// --- No-future-leakage proof: the CORE requirement (item 4/14/31) ---

test('NO FUTURE LEAKAGE: every feature computed as of day 40 is IDENTICAL whether or not days 41-70 exist in the input array', () => {
  const fullBars = makeBars();
  const truncatedBars = fullBars.filter((b) => new Date(b.timestamp).getTime() <= new Date(day(40)).getTime());
  const asOf = day(40);

  assert.equal(computeReturn(fullBars, asOf, 5), computeReturn(truncatedBars, asOf, 5));
  assert.equal(computeRealizedVolatility(fullBars, asOf, 20), computeRealizedVolatility(truncatedBars, asOf, 20));
  assert.equal(computeDownsideVolatility(fullBars, asOf, 20), computeDownsideVolatility(truncatedBars, asOf, 20));
  assert.equal(computeCurrentDrawdown(fullBars, asOf, 20), computeCurrentDrawdown(truncatedBars, asOf, 20));
  assert.equal(computeTrendSlope(fullBars, asOf, 20), computeTrendSlope(truncatedBars, asOf, 20));
  assert.equal(computeGapFrequency(fullBars, asOf, 20, 0.02), computeGapFrequency(truncatedBars, asOf, 20, 0.02));
  assert.equal(computeMaxAdverseGap(fullBars, asOf, 20), computeMaxAdverseGap(truncatedBars, asOf, 20));
});

test('NO FUTURE LEAKAGE: a feature computed as of day 40 does NOT see the day-50 gap even though it exists later in the full series', () => {
  const fullBars = makeBars();
  const asOf = day(40);
  // The day-50 gap is deliberately large (~9%); if this leaked, gap
  // frequency/max-adverse-gap computed "as of day 40" would be nonzero.
  assert.equal(computeGapFrequency(fullBars, asOf, 20, 0.02), 0);
  assert.equal(computeMaxAdverseGap(fullBars, asOf, 20), 0);
});
