import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntradayStructure, observeIntradayStructure } from '../src/theta/strategy-intelligence/intraday-structure.js';
import type { HistoricalBar } from '../src/theta/underlying-history.js';

const open = '2026-10-08T13:30:00.000Z', now = '2026-10-08T14:30:20.000Z';
const context = { underlying: 'SPY', requestedAt: now, observedAt: now, sessionOpen: open, sessionClose: '2026-10-08T20:00:00Z' };
const bars = (): HistoricalBar[] => Array.from({ length: 61 }, (_, i) => ({ symbol: 'SPY',
  timestamp: new Date(Date.parse(open) + i * 60_000).toISOString(), open: 100 + i, high: 101 + i, low: 99 + i,
  close: 100 + i, volume: 10, vwap: 100 + i, tradeCount: 1, provider: 'ALPACA', feed: 'iex', receivedAt: now }));

test('completed candles produce EMA9 and two confirming 5m closes without developing-bar lookahead', () => {
  const result = buildIntradayStructure({ ...context, bars: bars(), complete: true });
  assert.equal(result.closedMinuteCount, 60);
  assert.equal(result.excludedDevelopingCount, 1);
  assert.deepEqual(result.frames.map(f => f.closedCount), [60, 12, 4, 1]);
  assert.equal(result.frames[1]?.confirmingCloses, 2);
  assert.equal(result.frames[1]?.lastCloseVsEma9, 'ABOVE');
  assert.equal(result.sessionVwap, 129.5);
  assert.equal(result.brokerAuthority, false);
  assert.equal(result.authority, 'SHADOW_CONTEXT');
  const changedFuture = bars(); changedFuture[60] = { ...(changedFuture[60] as HistoricalBar), close: 999, high: 1000 };
  assert.deepEqual(buildIntradayStructure({ ...context, bars: changedFuture, complete: true }), result);
  assert.equal('bars' in result, false, 'raw arguments cannot leak through a receipt spread');
});

test('a candle partial at request time stays excluded even if it closes during network transit', () => {
  const result = buildIntradayStructure({ ...context, observedAt: '2026-10-08T14:31:01Z', bars: bars(), complete: true });
  assert.equal(result.closedMinuteCount, 60);
});

test('missing minute, incomplete pagination, unavailable VWAP and stale bars remain partial', () => {
  const missing = bars().filter((_, i) => i !== 52);
  const result = buildIntradayStructure({ ...context, bars: missing, complete: false });
  assert.equal(result.state, 'PARTIAL');
  assert.ok(result.reasons.includes('INCOMPLETE_5M_BUCKET'));
  assert.equal(result.frames[1]?.confirmingCloses, 0, 'a gap must reset EMA warmup');
  assert.equal(result.sessionVwap, null);
  assert.equal(buildIntradayStructure({ ...context, bars: bars().map(b => ({ ...b, vwap: null })), complete: true }).sessionVwap, null);
  assert.equal(buildIntradayStructure({ ...context, bars: bars().slice(0, 20), complete: true }).stale, true);
});

test('identity, malformed values, duplicate observations and future availability fail explicitly', () => {
  for (const patch of [{ symbol: 'XLE' }, { close: NaN }, { volume: -1 }, { receivedAt: '2026-10-09T00:00:00Z' }])
    assert.throws(() => buildIntradayStructure({ ...context, bars: [{ ...(bars()[0] as HistoricalBar), ...patch }], complete: true }), /INTRADAY_BAR_INVALID/);
  assert.throws(() => buildIntradayStructure({ ...context, bars: [bars()[0] as HistoricalBar, bars()[0] as HistoricalBar], complete: true }), /INTRADAY_BAR_INVALID/);
});

test('producer uses one GET, no retries, explicit IEX/raw/1Min, and typed optional failures', async () => {
  let calls = 0;
  const alpaca = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'synthetic', apiSecret: 'synthetic', fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const request = new URL(String(url));
      assert.equal(init?.method ?? 'GET', 'GET');
      assert.equal(request.searchParams.get('feed'), 'iex');
      assert.equal(request.searchParams.get('timeframe'), '1Min');
      assert.equal(request.searchParams.get('adjustment'), 'raw');
      return new Response('provider unavailable', { status: 503 });
    }) as typeof fetch };
  const failed = await observeIntradayStructure({ ...context, alpaca, marketOpen: true, now: () => now });
  assert.equal(calls, 1);
  assert.equal(failed.state, 'PROVIDER_ERROR');
  assert.deepEqual(failed.reasons, ['SERVER_ERROR']);
  const closed = await observeIntradayStructure({ ...context, alpaca, marketOpen: false, now: () => now });
  assert.equal(calls, 1);
  assert.equal(closed.state, 'NOT_APPLICABLE');
});
