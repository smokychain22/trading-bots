import assert from 'node:assert/strict';
import test from 'node:test';
import {
  barsAsOf,
  fetchAllHistoricalBars,
  parseAlpacaBarsPage,
  type RawAlpacaBarsPage,
} from '../src/theta/underlying-history.js';

const NOW = '2026-09-10T15:00:00.000Z';

const rawBar = (t: string, c: number) => ({ t, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000, n: 10, vw: c });

test('parseAlpacaBarsPage normalizes a multi-symbol response into flat bars, preserving pagination token', () => {
  const raw: RawAlpacaBarsPage = {
    bars: { SPY: [rawBar('2026-09-01T00:00:00Z', 500), rawBar('2026-09-02T00:00:00Z', 501)], QQQ: [rawBar('2026-09-01T00:00:00Z', 400)] },
    next_page_token: 'token-1',
  };
  const { bars, nextPageToken } = parseAlpacaBarsPage(raw, 'iex', NOW);
  assert.equal(bars.length, 3);
  assert.equal(nextPageToken, 'token-1');
  assert.equal(bars[0]?.symbol, 'SPY');
  assert.equal(bars[0]?.provider, 'ALPACA');
  assert.equal(bars[0]?.feed, 'iex');
});

test('missing optional fields (trade count, vwap) become null, never zero', () => {
  const raw: RawAlpacaBarsPage = { bars: { SPY: [{ t: NOW, o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }] }, next_page_token: null };
  const { bars } = parseAlpacaBarsPage(raw, null, NOW);
  assert.equal(bars[0]?.tradeCount, null);
  assert.equal(bars[0]?.vwap, null);
});

test('fetchAllHistoricalBars follows next_page_token to completion, never truncating early', async () => {
  const pages: RawAlpacaBarsPage[] = [
    { bars: { SPY: [rawBar('2026-09-01T00:00:00Z', 500)] }, next_page_token: 'p2' },
    { bars: { SPY: [rawBar('2026-09-02T00:00:00Z', 501)] }, next_page_token: 'p3' },
    { bars: { SPY: [rawBar('2026-09-03T00:00:00Z', 502)] }, next_page_token: null },
  ];
  let callCount = 0;
  const fetchPage = async (pageToken: string | null) => {
    assert.equal(pageToken, callCount === 0 ? null : `p${callCount + 1}`);
    const page = pages[callCount];
    callCount += 1;
    if (page === undefined) throw new Error('unexpected extra page request');
    return page;
  };
  const bars = await fetchAllHistoricalBars(fetchPage, NOW, 'iex', 10);
  assert.equal(bars.length, 3);
  assert.equal(callCount, 3);
});

test('fetchAllHistoricalBars refuses to silently truncate when maxPages is exceeded with more pages remaining', async () => {
  const fetchPage = async (): Promise<RawAlpacaBarsPage> => ({ bars: { SPY: [rawBar(NOW, 500)] }, next_page_token: 'always-more' });
  await assert.rejects(() => fetchAllHistoricalBars(fetchPage, NOW, 'iex', 2), /exceeded maxPages/);
});

test('barsAsOf excludes any bar timestamped after asOf -- no future leakage', () => {
  const raw: RawAlpacaBarsPage = {
    bars: { SPY: [rawBar('2026-09-01T00:00:00Z', 500), rawBar('2026-09-05T00:00:00Z', 505), rawBar('2026-09-10T00:00:00Z', 510)] },
    next_page_token: null,
  };
  const { bars } = parseAlpacaBarsPage(raw, 'iex', NOW);
  const asOf = barsAsOf(bars, '2026-09-05T00:00:00Z');
  assert.equal(asOf.length, 2);
  assert.ok(asOf.every((b) => new Date(b.timestamp).getTime() <= new Date('2026-09-05T00:00:00Z').getTime()));
});

test('barsAsOf is inclusive of a bar exactly at asOf, never accidentally excludes the boundary', () => {
  const raw: RawAlpacaBarsPage = { bars: { SPY: [rawBar('2026-09-05T00:00:00Z', 505)] }, next_page_token: null };
  const { bars } = parseAlpacaBarsPage(raw, 'iex', NOW);
  assert.equal(barsAsOf(bars, '2026-09-05T00:00:00Z').length, 1);
});
