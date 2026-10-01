import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeRealizedVolatility } from '../src/theta/underlying-features.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

interface ParityCase { readonly name: string; readonly window: number; readonly closes: readonly number[]; readonly expected: number | null }
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/realized-volatility-parity.json', import.meta.url)), 'utf8')) as
  { readonly cases: readonly ParityCase[] };

const bars = (closes: readonly number[]): HistoricalBar[] => closes.map((close, i) => ({
  symbol: 'T', timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), open: close, high: close, low: close, close, volume: 1,
  tradeCount: null, vwap: null, provider: 'ALPACA', feed: 'iex', receivedAt: '2026-01-01T00:00:00Z',
}));

test('TypeScript production realized volatility is locked to the shared golden vectors the Python serving-parity function must also match', () => {
  assert.ok(fixture.cases.length >= 10);
  for (const row of fixture.cases) {
    const actual = computeRealizedVolatility(bars(row.closes), '2027-01-01T00:00:00Z', row.window);
    if (row.expected === null) assert.equal(actual, null, row.name);
    else {
      assert.notEqual(actual, null, row.name);
      assert.ok(Math.abs((actual as number) - row.expected) < 1e-12, `${row.name} window=${row.window}: ${actual} vs ${row.expected}`);
    }
  }
});

test('an unknown (too-short or non-positive) window is UNKNOWN, never a zero volatility', () => {
  assert.equal(computeRealizedVolatility(bars([100, 101, 102]), '2027-01-01T00:00:00Z', 5), null);
  assert.equal(computeRealizedVolatility(bars([100, 0, 101, 102, 103, 104]), '2027-01-01T00:00:00Z', 5), null);
});
