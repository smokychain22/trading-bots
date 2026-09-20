import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorrelationEvidence } from '../src/theta/correlation-evidence.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const point = (symbol: string, day: number, close: number): HistoricalBar => ({
  symbol, timestamp: new Date(Date.UTC(2025, 0, day)).toISOString(), open: close, high: close, low: close,
  close, volume: 100, tradeCount: 1, vwap: close, provider: 'ALPACA', feed: 'iex',
  receivedAt: new Date(Date.UTC(2025, 0, 10)).toISOString(),
});

test('computes pairwise evidence only from synchronized PIT returns', () => {
  const bars = [1, 2, 3, 4].flatMap((day) => [point('AAA', day, 100 + day), point('BBB', day, 200 + day * 2)]);
  bars.push(point('AAA', 20, 1));
  const result = buildCorrelationEvidence(bars, {
    asOf: new Date(Date.UTC(2025, 0, 4)).toISOString(), lookbackBars: 3,
    evidenceVersion: 'corr-v1', dataVersion: 'bars-v1',
  });
  assert.equal(result.pairs[0]?.state, 'KNOWN');
  assert.ok((result.pairs[0]?.correlation ?? 0) > 0.99);
  assert.equal(result.pairs[0]?.overlappingReturnCount, 3);
});

test('insufficient overlap and zero variance remain UNKNOWN', () => {
  const insufficient = buildCorrelationEvidence([point('AAA', 1, 100), point('BBB', 1, 200)], {
    asOf: new Date(Date.UTC(2025, 0, 2)).toISOString(), lookbackBars: 2,
    evidenceVersion: 'corr-v1', dataVersion: 'bars-v1',
  });
  assert.equal(insufficient.pairs[0]?.missingReason, 'INSUFFICIENT_SYNCHRONIZED_RETURNS');
  const flat = [1, 2, 3].flatMap((day) => [point('AAA', day, 100), point('BBB', day, 200)]);
  assert.equal(buildCorrelationEvidence(flat, {
    asOf: new Date(Date.UTC(2025, 0, 3)).toISOString(), lookbackBars: 2,
    evidenceVersion: 'corr-v1', dataVersion: 'bars-v1',
  }).pairs[0]?.missingReason, 'ZERO_VARIANCE');
});
