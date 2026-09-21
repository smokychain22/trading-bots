import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAlpacaCorporateActions } from '../src/theta/alpaca-corporate-action-evidence.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const observedAt = '2026-09-21T14:00:00.000Z';
function config(fetchImpl: typeof fetch): AlpacaProviderConfig {
  return { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'test-only', apiSecret: 'test-only', fetchImpl };
}
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('positive split evidence is mapped and first-observed, while absence stays unqualified', async () => {
  const read = await readAlpacaCorporateActions({ config: config(async (url) => {
    const request = new URL(String(url));
    assert.equal(request.host, 'data.alpaca.markets');
    assert.equal(request.searchParams.get('data_quality'), 'all');
    return json({ corporate_actions: { forward_splits: [{ id: 'provider-private-id', symbol: 'AAPL',
      process_date: '2026-10-01', ex_date: '2026-10-01' }] }, next_page_token: null });
  }), symbols: ['AAPL'], start: '2026-09-21', end: '2026-10-21', observedAt });
  assert.equal(read.paginationComplete, true);
  assert.equal(read.negativeCoverageQualified, false);
  assert.equal(read.observations.length, 1);
  assert.equal(read.observations[0]?.pendingUnsupported, true);
  assert.equal(read.observations[0]?.providerKnownAt, null);
  assert.equal(read.observations[0]?.thetaFirstObservedAt, observedAt);
  assert.equal(JSON.stringify(read.observations[0]).includes('provider-private-id'), true); // raw payload remains server-side only
  const empty = await readAlpacaCorporateActions({ config: config(async () => json({ corporate_actions: {}, next_page_token: null })),
    symbols: ['AAPL'], start: '2026-09-21', end: '2026-10-21', observedAt });
  assert.equal(empty.observations.length, 0);
  assert.equal(empty.negativeCoverageQualified, false);
});

test('pagination is bounded and a repeated token fails closed', async () => {
  const partial = await readAlpacaCorporateActions({ config: config(async () => json({ corporate_actions: {}, next_page_token: 'later' })),
    symbols: ['SPY'], start: '2026-09-21', end: '2026-10-21', observedAt, maxPages: 1 });
  assert.equal(partial.paginationComplete, false);
  await assert.rejects(readAlpacaCorporateActions({ config: config(async () => json({ corporate_actions: {}, next_page_token: 'same' })),
    symbols: ['SPY'], start: '2026-09-21', end: '2026-10-21', observedAt, maxPages: 3 }), /PAGINATION_INVALID/);
});

test('host, symbol, and date mismatches cannot become evidence', async () => {
  const wrongHost = { ...config(async () => json({ corporate_actions: {}, next_page_token: null })), marketDataApiBase: 'https://api.alpaca.markets' };
  await assert.rejects(readAlpacaCorporateActions({ config: wrongHost, symbols: ['SPY'], start: '2026-09-21', end: '2026-10-21', observedAt }), /HOST_INVALID/);
  await assert.rejects(readAlpacaCorporateActions({ config: config(async () => json({ corporate_actions: {}, next_page_token: null })),
    symbols: ['SPY'], start: '2026-02-30', end: '2026-10-21', observedAt }), /WINDOW_INVALID/);
  await assert.rejects(readAlpacaCorporateActions({ config: config(async () => json({ corporate_actions: { cash_dividends: [{ symbol: 'TSLA' }] }, next_page_token: null })),
    symbols: ['SPY'], start: '2026-09-21', end: '2026-10-21', observedAt }), /SYMBOL_MISMATCH/);
});
