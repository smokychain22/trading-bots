// Phase 3: provider-boundary gaps found by the read-only coverage inventory. All use injected fetch (never network).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AlpacaProviderError, fetchOptionContracts, fetchOptionSnapshots, fetchMarketClock, type AlpacaProviderConfig,
} from '../src/theta/alpaca-provider.js';

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const config = (fetchImpl: typeof fetch): AlpacaProviderConfig => ({
  tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'TEST-SYNTHETIC-KEY-0000', apiSecret: 'TEST-SYNTHETIC-SECRET-0000', fetchImpl,
  readRetry: { sleep: async () => undefined, random: () => 0.5 },
});
const contractParams = { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put' as const, limit: 1, maxPages: 10 };
const snapshotParams = { underlyingSymbol: 'SPY', feed: 'indicative' as const, optionType: 'put' as const, limit: 10, maxPages: 10 };
const contractRow = (n: number) => ({ symbol: `SPY261009P00${500 + n}000`, strike_price: String(500 + n), expiration_date: '2026-10-09' });
const snapshotRow = (n: number) => [`SPY261009P00${500 + n}000`, { latestQuote: { bp: 1, ap: 1.1, t: '2026-10-02T15:00:00Z' } }] as const;

test('a multi-hop page-token cycle (A -> B -> A) fails closed for contracts and snapshots', async () => {
  const sequence = ['A', 'B', 'A', 'B', 'A'];
  for (const kind of ['contracts', 'snapshots'] as const) {
    let page = 0;
    const fetchImpl = (async () => {
      const token = sequence[page] ?? null; page += 1;
      return kind === 'contracts' ? json(200, { option_contracts: [contractRow(page)], next_page_token: token })
        : json(200, { snapshots: Object.fromEntries([snapshotRow(page)]), next_page_token: token });
    }) as typeof fetch;
    const run = kind === 'contracts' ? fetchOptionContracts(config(fetchImpl), contractParams) : fetchOptionSnapshots(config(fetchImpl), snapshotParams);
    await assert.rejects(run, (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE', kind);
    assert.ok(page <= 4, `${kind}: the cycle was followed ${page} times`);
  }
});

test('401, 403 and 404 after a valid first page are typed failures and never a truncated chain presented as complete', async () => {
  for (const [status, errorClass] of [[401, 'INVALID_AUTH'], [403, 'NOT_ENTITLED'], [404, 'INVALID_REQUEST']] as const) {
    for (const kind of ['contracts', 'snapshots'] as const) {
      let page = 0;
      const fetchImpl = (async () => {
        page += 1;
        if (page === 1) return kind === 'contracts' ? json(200, { option_contracts: [contractRow(1)], next_page_token: 'p2' })
          : json(200, { snapshots: Object.fromEntries([snapshotRow(1)]), next_page_token: 'p2' });
        return json(status, { message: 'provider failed' });
      }) as typeof fetch;
      const run = kind === 'contracts' ? fetchOptionContracts(config(fetchImpl), contractParams) : fetchOptionSnapshots(config(fetchImpl), snapshotParams);
      await assert.rejects(run, (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === errorClass, `${kind} ${status}`);
    }
  }
});

test('a truncated JSON body (HTTP 200) is MALFORMED_RESPONSE, never an empty or partial chain', async () => {
  const truncated = (async () => new Response('{"option_contracts":[{"symbol":"SPY261009P00500000","strike_pri', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  await assert.rejects(fetchOptionContracts(config(truncated), contractParams), (error: unknown) =>
    error instanceof AlpacaProviderError && (error.errorClass === 'MALFORMED_RESPONSE' || error.errorClass === 'NETWORK_ERROR'));
});

test('TLS failures are typed network failures with a protocol code, never a strategy rejection', async () => {
  for (const code of ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    const fetchImpl = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('tls'), { code }) }); }) as typeof fetch;
    await assert.rejects(fetchMarketClock(config(fetchImpl), '2026-10-02T15:00:00Z'), (error: unknown) =>
      error instanceof AlpacaProviderError && error.errorClass === 'NETWORK_ERROR' && error.safeDetailCode === 'PROVIDER_TLS_FAILURE', code);
  }
});

test('the market clock exposes a far-future provider timestamp verbatim so freshness consumers can reject it (never normalised to now)', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const fetchImpl = (async () => json(200, { timestamp: future, is_open: true, next_open: future, next_close: future })) as typeof fetch;
  const clock = await fetchMarketClock(config(fetchImpl), '2026-10-02T15:00:00Z');
  assert.equal(clock.timestamp, future);
});
