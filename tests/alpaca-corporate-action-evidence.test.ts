import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPersistedPendingCorporateActionSymbols, readAlpacaCorporateActions } from '../src/theta/alpaca-corporate-action-evidence.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import type { Pool } from 'pg';

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

test('a sparse later response cannot erase a persisted positive action in the decision window', async () => {
  const pool = { query: async (sql: string, params: unknown[]) => {
    assert.match(sql, /pending_unsupported = true/);
    assert.match(sql, /first_observed_at <= \$4::timestamptz/);
    assert.match(sql, /process_date BETWEEN/);
    assert.match(sql, /ex_date BETWEEN/);
    assert.deepEqual(params, [['AAPL'], '2026-09-21', '2026-10-21', '2026-09-23T14:00:00.000Z']);
    return { rows: [{ symbol: 'AAPL' }] };
  } } as unknown as Pick<Pool, 'query'>;
  const result = await loadPersistedPendingCorporateActionSymbols(pool, {
    symbols: ['AAPL', 'AAPL'], start: '2026-09-21', end: '2026-10-21',
    decisionAsOf: '2026-09-23T14:00:00.000Z',
  });
  assert.deepEqual([...result], ['AAPL']);
});

test('persisted positive lookup fails closed on bad input, corrupt row, or storage error', async () => {
  const input = { symbols: ['AAPL'], start: '2026-09-21', end: '2026-10-21',
    decisionAsOf: '2026-09-23T14:00:00.000Z' };
  const invalid = { query: async () => ({ rows: [{ symbol: 'MSFT' }] }) } as unknown as Pick<Pool, 'query'>;
  await assert.rejects(loadPersistedPendingCorporateActionSymbols(invalid, input), /PERSISTED_ROW_INVALID/);
  const broken = { query: async () => { throw new Error('storage unavailable'); } } as unknown as Pick<Pool, 'query'>;
  await assert.rejects(loadPersistedPendingCorporateActionSymbols(broken, input), /storage unavailable/);
  await assert.rejects(loadPersistedPendingCorporateActionSymbols(invalid, { ...input, start: '2026-02-30' }), /LOOKUP_INVALID/);
});
