import assert from 'node:assert/strict';
import test from 'node:test';
import { extractHistoricalBars } from '../src/theta/historical-bar-extraction.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const bar = (symbol: string, day: number, feed = 'iex'): HistoricalBar => ({
  symbol, timestamp: new Date(Date.UTC(2025, 0, day)).toISOString(), open: 100, high: 101, low: 99, close: 100,
  volume: 10, tradeCount: 1, vwap: 100, provider: 'ALPACA', feed,
  receivedAt: '2025-02-01T00:00:00.000Z',
});
const request = {
  eligibleUnderlyings: ['MSFT', 'AAPL', 'MISSING'], requestWindow: { start: '2025-01-01T00:00:00Z', end: '2025-01-03T23:59:59Z' },
  asOf: '2025-01-04T00:00:00Z', retrievedAt: '2025-02-01T00:00:00Z', feed: 'iex', timeframe: '1Day',
  adjustment: 'SPLIT_ADJUSTED' as const, dataVersion: 'alpaca-bars-v1',
};

test('extracts deterministic eligible PIT bars with request provenance and missingness', () => {
  const input = [bar('AAPL', 2), bar('MSFT', 1), bar('AAPL', 1), bar('OTHER', 1), bar('AAPL', 9), bar('MSFT', 2, 'sip')];
  const first = extractHistoricalBars(input, request);
  const second = extractHistoricalBars([...input].reverse(), request);
  assert.deepEqual(first.bars.map((item) => `${item.symbol}:${item.timestamp}`), second.bars.map((item) => `${item.symbol}:${item.timestamp}`));
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.missingUnderlyings, ['MISSING']);
  assert.deepEqual(first.observedDatesByUnderlying.AAPL, ['2025-01-01', '2025-01-02']);
});

test('rejects a request whose retrieval chronology is invalid', () => {
  assert.throws(() => extractHistoricalBars([], { ...request, asOf: '2025-03-01T00:00:00Z' }), /start <= end <= asOf <= retrievedAt/);
});
