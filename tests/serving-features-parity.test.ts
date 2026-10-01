import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeGapFrequency, computeMaxAdverseGap, computeTrendSlope } from '../src/theta/underlying-features.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

interface Expected { readonly trendSlope: number | null; readonly gapFrequency: number | null; readonly maxAdverseGap: number | null }
interface ParityCase { readonly name: string; readonly window: number; readonly gapThreshold: number;
  readonly opens: readonly number[]; readonly closes: readonly number[]; readonly expected: Expected }
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/serving-features-parity.json', import.meta.url)), 'utf8')) as
  { readonly cases: readonly ParityCase[] };

const bars = (row: ParityCase): HistoricalBar[] => row.closes.map((close, i) => ({
  symbol: 'T', timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), open: row.opens[i] as number,
  high: Math.max(close, row.opens[i] as number), low: Math.min(close, row.opens[i] as number), close, volume: 1,
  tradeCount: null, vwap: null, provider: 'ALPACA', feed: 'iex', receivedAt: '2026-01-01T00:00:00Z',
}));
const close = (actual: number | null, expected: number | null, label: string): void => {
  if (expected === null) assert.equal(actual, null, label);
  else { assert.notEqual(actual, null, label); assert.ok(Math.abs((actual as number) - expected) < 1e-12, `${label}: ${actual} vs ${expected}`); }
};

test('TypeScript production trend slope, gap frequency and adverse gap are locked to the golden vectors the Python serving-parity functions also match', () => {
  assert.ok(fixture.cases.length >= 11);
  const asOf = '2027-01-01T00:00:00Z';
  for (const row of fixture.cases) {
    const series = bars(row);
    const label = `${row.name} window=${row.window}`;
    close(computeTrendSlope(series, asOf, row.window), row.expected.trendSlope, `${label} trendSlope`);
    close(computeGapFrequency(series, asOf, row.window, row.gapThreshold), row.expected.gapFrequency, `${label} gapFrequency`);
    close(computeMaxAdverseGap(series, asOf, row.window), row.expected.maxAdverseGap, `${label} maxAdverseGap`);
  }
});
