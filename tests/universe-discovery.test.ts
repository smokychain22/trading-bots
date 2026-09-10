import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverRealUniverse, type UniverseDiscoveryConfig } from '../src/theta/universe-discovery.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const NOW = '2026-09-10T15:00:00.000Z';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const baseDiscoveryConfig = (overrides: Partial<UniverseDiscoveryConfig> = {}): UniverseDiscoveryConfig => ({
  discoveryVersion: 'universe-discovery-v1-test',
  maxCandidateAssets: 100,
  allowedExchanges: null,
  barsLookbackDays: 30,
  barsBatchSize: 50,
  maxOptionabilityChecks: 10,
  minCurrentPrice: 5,
  ...overrides,
});

function bar(symbol: string, close: number, volume: number, timestamp = NOW): Record<string, unknown> {
  return { t: timestamp, o: close, h: close, l: close, c: close, v: volume };
}

test('a real (mocked) end-to-end discovery: assets -> bars -> optionability confirmation -> candidates', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/assets')) {
      return jsonResponse(200, [
        { symbol: 'SPY', exchange: 'ARCA', class: 'us_equity', tradable: true, status: 'active', fractionable: true },
        { symbol: 'PENNY', exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false },
        { symbol: 'NOTOPTIONABLE', exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false },
      ]);
    }
    if (url.includes('/v2/stocks/bars')) {
      return jsonResponse(200, { bars: { SPY: [bar('SPY', 500, 1_000_000)], PENNY: [bar('PENNY', 1, 100)], NOTOPTIONABLE: [bar('NOTOPTIONABLE', 50, 10_000)] }, next_page_token: null });
    }
    if (url.includes('/v2/options/contracts')) {
      const isSpy = url.includes('underlying_symbols=SPY');
      return jsonResponse(200, { option_contracts: isSpy ? [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }] : [], next_page_token: null });
    }
    throw new Error(`unmocked URL: ${url}`);
  }) as typeof fetch;

  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'TEST-SYNTHETIC-KEY', apiSecret: 'TEST-SYNTHETIC-SECRET', fetchImpl };

  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig(), () => NOW);

  assert.equal(result.funnel.assetsDiscovered, 3);
  // PENNY is filtered out by minCurrentPrice ($1 < $5 floor) before ever
  // reaching the optionability check.
  assert.equal(result.funnel.assetsWithUsableBars, 2);
  assert.equal(result.funnel.optionabilityChecksAttempted, 2);
  assert.equal(result.funnel.optionableConfirmed, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.symbol, 'SPY');
  assert.equal(result.candidates[0]?.avgDollarVolume, 500 * 1_000_000);
  assert.equal(result.candidatesOrigin, 'REAL_PROVIDER');
  assert.equal(result.blockers.length, 0);
});

test('a symbol confirmed to have zero real option contracts is excluded, never guessed optionable', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/assets')) return jsonResponse(200, [{ symbol: 'NOOPT', exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false }]);
    if (url.includes('/v2/stocks/bars')) return jsonResponse(200, { bars: { NOOPT: [bar('NOOPT', 100, 1_000_000)] }, next_page_token: null });
    if (url.includes('/v2/options/contracts')) return jsonResponse(200, { option_contracts: [], next_page_token: null });
    throw new Error(`unmocked URL: ${url}`);
  }) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig(), () => NOW);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.funnel.optionableConfirmed, 0);
});

test('an exchange prefilter genuinely excludes non-matching exchanges before any bars call', async () => {
  let barsRequestedSymbols: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/assets')) return jsonResponse(200, [
      { symbol: 'SPY', exchange: 'ARCA', class: 'us_equity', tradable: true, status: 'active', fractionable: true },
      { symbol: 'OTCSTOCK', exchange: 'OTC', class: 'us_equity', tradable: true, status: 'active', fractionable: false },
    ]);
    if (url.includes('/v2/stocks/bars')) {
      barsRequestedSymbols = new URL(url).searchParams.get('symbols')?.split(',') ?? [];
      return jsonResponse(200, { bars: { SPY: [bar('SPY', 500, 1_000_000)] }, next_page_token: null });
    }
    if (url.includes('/v2/options/contracts')) return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }], next_page_token: null });
    throw new Error(`unmocked URL: ${url}`);
  }) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig({ allowedExchanges: ['ARCA', 'NASDAQ'] }), () => NOW);
  assert.deepEqual(barsRequestedSymbols, ['SPY']);
  assert.equal(result.funnel.assetsAfterExchangeFilter, 1);
});

test('an assets-fetch failure is recorded honestly and returns an empty (never fabricated) universe', async () => {
  const fetchImpl = (async () => new Response('', { status: 500 })) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig(), () => NOW);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.candidatesOrigin, 'REAL_PROVIDER_ERROR');
  assert.ok(result.blockers.some((b) => b.startsWith('UNIVERSE_ASSETS_FETCH_FAILED')));
});

test('a failed bars batch loses only that batch, never the whole discovery run', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/assets')) return jsonResponse(200, [
      { symbol: 'A', exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false },
      { symbol: 'B', exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false },
    ]);
    if (url.includes('/v2/stocks/bars')) {
      const symbols = new URL(url).searchParams.get('symbols');
      if (symbols === 'A') return new Response('', { status: 500 });
      return jsonResponse(200, { bars: { B: [bar('B', 100, 1_000_000)] }, next_page_token: null });
    }
    if (url.includes('/v2/options/contracts')) return jsonResponse(200, { option_contracts: [{ symbol: 'B261009P00100000', strike_price: '100', expiration_date: '2026-10-09' }], next_page_token: null });
    throw new Error(`unmocked URL: ${url}`);
  }) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig({ barsBatchSize: 1 }), () => NOW);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.symbol, 'B');
  assert.ok(result.blockers.some((b) => b.startsWith('UNIVERSE_BARS_BATCH_FAILED')));
});

test('the universe-asset bound is honestly reported when truncated', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input);
    if (url.includes('/v2/assets')) return jsonResponse(200, Array.from({ length: 5 }, (_, i) => ({ symbol: `SYM${i}`, exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false })));
    if (url.includes('/v2/stocks/bars')) return jsonResponse(200, { bars: {}, next_page_token: null });
    throw new Error(`unmocked URL: ${url}`);
  }) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  const result = await discoverRealUniverse(alpaca, baseDiscoveryConfig({ maxCandidateAssets: 3 }), () => NOW);
  assert.equal(result.funnel.assetsTruncatedByBound, true);
  assert.equal(result.funnel.assetsDiscovered, 3);
});
