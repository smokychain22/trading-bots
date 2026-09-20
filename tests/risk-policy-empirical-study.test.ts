import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSevereDrawdownStudy } from '../src/research/risk-policy-empirical-study.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

function bar(symbol: string, day: number, close: number): HistoricalBar {
  const timestamp = new Date(Date.UTC(2026, 0, day)).toISOString();
  return { symbol, timestamp, open: close, high: close, low: close, close, volume: 100,
    tradeCount: 1, vwap: close, provider: 'ALPACA', feed: 'iex', receivedAt: '2026-04-01T00:00:00.000Z' };
}

test('severe drawdown cells use future lows only after the entry timestamp', () => {
  const bars = [bar('TEST', 1, 100), bar('TEST', 2, 95), bar('TEST', 3, 89), bar('TEST', 31, 90), bar('TEST', 32, 110)];
  const cells = buildSevereDrawdownStudy(bars, [{ symbol: 'TEST', family: 'HIGHER_VOL_SINGLE' }]);
  const cell = cells.find((item) => item.id === 'A_30D_10PCT');
  assert.equal(cell?.breachedN, 1);
  assert.ok(Math.abs((cell?.maeDistribution.min ?? 0) - (-0.11)) < 1e-12);
});

test('right-censored entries never become survived or breached labels', () => {
  const bars = [bar('TEST', 1, 100), bar('TEST', 2, 50), bar('TEST', 3, 40)];
  const cells = buildSevereDrawdownStudy(bars, [{ symbol: 'TEST', family: 'HIGHER_VOL_SINGLE' }]);
  const cell = cells.find((item) => item.id === 'A_30D_10PCT');
  assert.equal(cell?.resolvedN, 0);
  assert.equal(cell?.breachedN, 0);
  assert.equal(cell?.censoredN, 3);
});

test('overlapping windows collapse into dependence groups instead of pretending each row is independent', () => {
  const bars = Array.from({ length: 80 }, (_, index) => bar('TEST', index + 1, 100 - index * 0.1));
  const cells = buildSevereDrawdownStudy(bars, [{ symbol: 'TEST', family: 'LOWER_VOL_SINGLE' }]);
  const cell = cells.find((item) => item.id === 'A_30D_10PCT');
  assert.ok((cell?.rawN ?? 0) > (cell?.effectiveN ?? 0));
});

test('family cohorts preserve their explicit research classification', () => {
  const bars = Array.from({ length: 80 }, (_, index) => [bar('ETF', index + 1, 100), bar('SINGLE', index + 1, 100)]).flat();
  const cells = buildSevereDrawdownStudy(bars, [
    { symbol: 'ETF', family: 'BROAD_ETF' }, { symbol: 'SINGLE', family: 'LOWER_VOL_SINGLE' },
  ]);
  const cell = cells.find((item) => item.id === 'A_30D_10PCT');
  assert.ok('BROAD_ETF' in (cell?.byFamily ?? {}));
  assert.ok('LOWER_VOL_SINGLE' in (cell?.byFamily ?? {}));
});
