import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorrelationWindowStabilityReport } from '../src/research/correlation-window-stability.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const point = (symbol: string, day: number, close: number): HistoricalBar => ({
  symbol, timestamp: new Date(Date.UTC(2025, 0, day)).toISOString(), open: close, high: close, low: close,
  close, volume: 100, tradeCount: 1, vwap: close, provider: 'ALPACA', feed: 'iex',
  receivedAt: new Date(Date.UTC(2025, 0, 20)).toISOString(),
});

// Two regimes: days 1-8 AAA rises while BBB falls (negative correlation); days
// 9-15 both rise together (positive correlation). A short window (5) sees
// only the second regime; a long window (13) spans both.
function regimeChangeBars(): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  for (let day = 1; day <= 8; day += 1) {
    bars.push(point('AAA', day, 100 + day));
    bars.push(point('BBB', day, 300 - day * 3));
  }
  for (let day = 9; day <= 15; day += 1) {
    bars.push(point('AAA', day, 100 + day));
    bars.push(point('BBB', day, 100 + day * 3));
  }
  return bars;
}

test('rejects fewer than two distinct windows', () => {
  assert.throws(() => buildCorrelationWindowStabilityReport([], {
    asOf: new Date(Date.UTC(2025, 0, 15)).toISOString(), windows: [20], evidenceVersion: 'v1', dataVersion: 'v1',
  }), /WINDOW_STABILITY_REQUIRES_AT_LEAST_TWO/);
  assert.throws(() => buildCorrelationWindowStabilityReport([], {
    asOf: new Date(Date.UTC(2025, 0, 15)).toISOString(), windows: [20, 20], evidenceVersion: 'v1', dataVersion: 'v1',
  }), /WINDOW_STABILITY_REQUIRES_AT_LEAST_TWO/);
});

test('short window sees only the recent positive regime; long window mixes both', () => {
  const report = buildCorrelationWindowStabilityReport(regimeChangeBars(), {
    asOf: new Date(Date.UTC(2025, 0, 15)).toISOString(), windows: [5, 13], evidenceVersion: 'corr-window-v1', dataVersion: 'bars-v1',
  });
  const pair = report.pairs.find((p) => p.left === 'AAA' && p.right === 'BBB');
  assert.ok(pair, 'expected AAA/BBB pair to be present');
  const short = pair?.windowValues.find((w) => w.window === 5);
  const long = pair?.windowValues.find((w) => w.window === 13);
  assert.equal(short?.state, 'KNOWN');
  assert.ok((short?.correlation ?? -1) > 0.9, 'short window should show strong positive correlation from the second regime alone');
  assert.equal(long?.state, 'KNOWN');
  // The long window spans a negative-correlation regime and a positive-correlation
  // regime, so it must differ materially from the short window -- this is exactly
  // the instability this tool exists to surface, not a specific sign this test
  // should hardcode.
  assert.notEqual(long?.correlation, short?.correlation);
  assert.ok(pair !== undefined && pair.classification !== 'STABLE', 'a genuine regime change must not classify as STABLE');
  assert.equal(pair?.knownWindowCount, 2);
});

test('a pair unknown in every window is INSUFFICIENT_KNOWN_WINDOWS, never defaulted to STABLE', () => {
  const sparse = [point('AAA', 1, 100), point('BBB', 1, 200)];
  const report = buildCorrelationWindowStabilityReport(sparse, {
    asOf: new Date(Date.UTC(2025, 0, 1)).toISOString(), windows: [5, 10], evidenceVersion: 'v1', dataVersion: 'v1',
  });
  const pair = report.pairs.find((p) => p.left === 'AAA' && p.right === 'BBB');
  assert.equal(pair?.classification, 'INSUFFICIENT_KNOWN_WINDOWS');
  assert.equal(pair?.knownWindowCount, 0);
});
