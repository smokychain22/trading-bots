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
  assert.equal(buildIntradayStructure({ ...context, bars: missing, complete: true }).sessionVwap, null,
    'complete pagination cannot prove session VWAP when a minute is missing');
  assert.equal(buildIntradayStructure({ ...context, bars: bars().map(b => ({ ...b, vwap: null })), complete: true }).sessionVwap, null);
  assert.equal(buildIntradayStructure({ ...context, bars: bars().slice(0, 20), complete: true }).stale, true);
});

const history = (sessionOpen: string, count = 390): HistoricalBar[] => Array.from({ length: count }, (_, i) => ({
  ...(bars()[0] as HistoricalBar), timestamp: new Date(Date.parse(sessionOpen) + i * 60_000).toISOString(),
  open: 90, high: 91, low: 89, close: 90, vwap: 90,
}));
const warmupSessions = [
  { open: '2026-10-06T13:30:00.000Z', close: '2026-10-06T20:00:00.000Z' },
  { open: '2026-10-07T13:30:00.000Z', close: '2026-10-07T20:00:00.000Z' },
] as const;

test('two prior regular sessions warm hourly EMA without including overnight, partial close buckets or prior-session VWAP', () => {
  const inputBars = [...warmupSessions.flatMap(s => history(s.open)), ...bars()];
  const result = buildIntradayStructure({ ...context, bars: inputBars, warmupSessions, complete: true });
  const hourly = result.frames.find(f => f.minutes === 60);
  assert.ok(hourly);
  assert.equal(hourly.closedCount, 13);
  assert.equal(hourly.continuousCount, 13);
  assert.equal(hourly.ema9, 103.8);
  assert.equal(result.sessionVwap, 129.5, 'today VWAP excludes prior sessions');
  assert.equal(result.closedMinuteCount, 60, 'current-session coverage remains separate from warmup');
  assert.equal(result.frames[0]?.closedCount, 840);
  assert.equal(result.warmupPolicy, 'SESSION_ANCHORED_FULL_BUCKETS_ONLY');
  assert.equal(hourly.bars.some(b => b.start.endsWith('19:30:00.000Z')), false, 'half-hour close bucket is never labeled a full hour');
  assert.equal(result.brokerAuthority, false);
  assert.deepEqual(buildIntradayStructure({ ...context, bars: inputBars, warmupSessions, complete: true }), result, 'deterministic replay');
});

test('a wholly absent trailing hourly bucket or session resets warmup rather than bridging a data gap', () => {
  const complete = warmupSessions.flatMap(s => history(s.open));
  const missingBucket = complete.filter(b => !(b.timestamp >= '2026-10-07T18:30:00.000Z' && b.timestamp < '2026-10-07T19:30:00.000Z'));
  for (const prior of [missingBucket, complete.filter(b => b.timestamp < warmupSessions[1].open)]) {
    const result = buildIntradayStructure({ ...context, bars: [...prior, ...bars()], warmupSessions, complete: true });
    assert.equal(result.frames[3]?.continuousCount, 1);
    assert.equal(result.frames[3]?.ema9, null);
    assert.ok(result.reasons.includes('INCOMPLETE_60M_BUCKET'));
  }
});

test('calendar early closes and weekend/DST gaps are valid boundaries, overlapping or future sessions are rejected', () => {
  const sessions = [
    { open: '2026-10-30T13:30:00.000Z', close: '2026-10-30T17:00:00.000Z' },
    { open: '2026-11-02T14:30:00.000Z', close: '2026-11-02T21:00:00.000Z' },
  ] as const;
  const at = '2026-11-03T15:30:20.000Z';
  const result = buildIntradayStructure({ ...context, requestedAt: at, observedAt: at,
    sessionOpen: '2026-11-03T14:30:00.000Z', sessionClose: '2026-11-03T21:00:00.000Z',
    warmupSessions: sessions, complete: true, bars: [...history(sessions[0].open, 210), ...history(sessions[1].open),
      ...history('2026-11-03T14:30:00.000Z', 60)] });
  assert.equal(result.frames[3]?.continuousCount, 10);
  assert.equal(result.frames[3]?.ema9, 90);
  for (const invalid of [[warmupSessions[0], warmupSessions[0]], [{ open: context.sessionOpen, close: context.sessionClose }]])
    assert.throws(() => buildIntradayStructure({ ...context, bars: bars(), complete: true, warmupSessions: invalid }), /INTRADAY_SESSION_BOUNDARY_INVALID/);
});

test('producer retrieves bounded prior-session bars and persists warmed frames through the same receipt', async () => {
  const requests: URL[] = [];
  const config = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'synthetic', apiSecret: 'synthetic', fetchImpl: (async (url: string | URL | Request) => {
      const request = new URL(String(url)); requests.push(request);
      if (request.pathname === '/v2/calendar') return Response.json(warmupSessions.map(s => ({ date: s.open.slice(0, 10), open: '09:30', close: '16:00' })));
      const start = request.searchParams.get('start');
      assert.ok(start);
      const values = start === context.sessionOpen ? bars() : history(start);
      return Response.json({ bars: { SPY: values.map(b => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, vw: b.vwap, n: 1 })) }, next_page_token: null });
    }) as typeof fetch };
  const result = await observeIntradayStructure({ ...context, alpaca: config, marketOpen: true, now: () => now });
  assert.equal(requests.length, 4, 'one calendar and three single-page bar reads, no retries');
  assert.equal(result.frames[3]?.closedCount, 13);
  assert.equal(result.frames[3]?.ema9, 103.8);
  assert.equal(result.warmupSessions.length, 2);
  assert.equal(result.authority, 'SHADOW_CONTEXT');
});

test('optional warmup failures preserve current-session evidence and never invent a warmed hourly signal', async () => {
  for (const calendarFails of [true, false]) {
    let calls = 0;
    const config = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
      apiKey: 'synthetic', apiSecret: 'synthetic', fetchImpl: (async (url: string | URL | Request) => {
        calls++;
        const request = new URL(String(url));
        if (request.pathname === '/v2/calendar') return calendarFails ? new Response('', { status: 503 })
          : Response.json(warmupSessions.map(s => ({ date: s.open.slice(0, 10), open: '09:30', close: '16:00' })));
        if (request.searchParams.get('start') !== context.sessionOpen) return new Response('', { status: 503 });
        return Response.json({ bars: { SPY: bars().map(b => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, vw: b.vwap, n: 1 })) }, next_page_token: null });
      }) as typeof fetch };
    const result = await observeIntradayStructure({ ...context, alpaca: config, marketOpen: true, now: () => now });
    assert.equal(result.state, 'PARTIAL');
    assert.equal(result.closedMinuteCount, 60);
    assert.equal(result.sessionVwap, 129.5);
    assert.equal(result.frames[3]?.ema9, null);
    assert.equal(result.brokerAuthority, false);
    assert.ok(result.reasons.includes(calendarFails ? 'WARMUP_CALENDAR_UNAVAILABLE' : 'WARMUP_PROVIDER_ERROR'));
    assert.equal(calls, calendarFails ? 2 : 4, 'bounded requests with no retry');
  }
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
