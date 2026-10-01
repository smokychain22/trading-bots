import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverRealUniverse, type UniverseDiscoveryConfig } from '../src/theta/universe-discovery.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const NOW = '2026-10-02T15:00:00.000Z';
const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const config = (overrides: Partial<UniverseDiscoveryConfig> = {}): UniverseDiscoveryConfig => ({
  discoveryVersion: 'universe-prerank-test', maxCandidateAssets: 100, allowedExchanges: ['NASDAQ'], barsLookbackDays: 30,
  barsBatchSize: 100, maxOptionabilityChecks: 5, minCurrentPrice: 5, ...overrides,
});

/** `total` tradable assets in provider order; the single high-liquidity asset sits at index `whalePosition`. */
function market(total: number, whalePosition: number, snapshots: 'OK' | 'FAIL' = 'OK') {
  const symbols = Array.from({ length: total }, (_, i) => (i === whalePosition ? 'WHALE' : `LOW${i}`));
  const barSymbolRequests: string[][] = [];
  let snapshotCalls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof URL ? input.toString() : String(input));
    if (url.pathname === '/v2/assets') {
      return json(symbols.map((symbol) => ({ symbol, exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active' })));
    }
    if (url.pathname === '/v2/stocks/snapshots') {
      snapshotCalls += 1;
      if (snapshots === 'FAIL') return new Response('{}', { status: 500 });
      const requested = (url.searchParams.get('symbols') ?? '').split(',');
      return json(Object.fromEntries(requested.map((symbol) => [symbol,
        { prevDailyBar: { c: 50, v: symbol === 'WHALE' ? 90_000_000 : 1_000 } }])));
    }
    if (url.pathname === '/v2/stocks/bars') {
      const requested = (url.searchParams.get('symbols') ?? '').split(',');
      barSymbolRequests.push(requested);
      return json({ bars: Object.fromEntries(requested.map((symbol) => [symbol,
        [{ t: NOW, o: 50, h: 50, l: 50, c: 50, v: 1_000 }]])), next_page_token: null });
    }
    if (url.pathname === '/v2/options/contracts') return json({ option_contracts: [], next_page_token: null });
    throw new Error(`unmocked ${url.pathname}`);
  }) as typeof fetch;
  const alpaca: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets',
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: 'K', apiSecret: 'S', fetchImpl };
  return { alpaca, barSymbolRequests, snapshotCalls: () => snapshotCalls };
}

for (const total of [99, 100]) {
  test(`${total} eligible assets fit the bound: no ranking needed, every asset considered`, async () => {
    const m = market(total, total - 1);
    const result = await discoverRealUniverse(m.alpaca, config(), () => NOW);
    assert.equal(m.snapshotCalls(), 0);
    assert.equal(result.funnel.assetsTruncatedByBound, false);
    assert.equal(m.barSymbolRequests.flat().length, total);
    assert.ok(m.barSymbolRequests.flat().includes('WHALE'));
  });
}

for (const total of [101, 500, 1000]) {
  test(`${total} eligible assets: a high-liquidity asset at position 101+ is ranked in before the bound, not cut arbitrarily`, async () => {
    const m = market(total, total - 1); // last in provider order: the old first-N cut could never see it
    const result = await discoverRealUniverse(m.alpaca, config(), () => NOW);
    assert.ok(m.snapshotCalls() >= 1);
    assert.equal(result.funnel.assetsDiscovered, total, 'discovered is the honest provider total');
    assert.equal(result.funnel.assetsTruncatedByBound, true);
    const consideredForBars = m.barSymbolRequests.flat();
    assert.equal(consideredForBars.length, 100, 'bound applied after ranking');
    assert.ok(consideredForBars.includes('WHALE'));
    assert.equal(result.blockers.includes('UNIVERSE_LIQUIDITY_PRERANK_UNAVAILABLE'), false);
    const exchangeStage = result.funnel.stageDiagnostics?.find((stage) => stage.stage === 'EXCHANGE_FILTER');
    assert.equal(exchangeStage?.reasonCounts.LIQUIDITY_PRERANK_NOT_SELECTED, total - 100);
  });
}

test('ranking is deterministic and independent of provider order', async () => {
  const a = market(300, 299), b = market(300, 0);
  await discoverRealUniverse(a.alpaca, config(), () => NOW);
  await discoverRealUniverse(b.alpaca, config(), () => NOW);
  assert.ok(a.barSymbolRequests.flat().includes('WHALE') && b.barSymbolRequests.flat().includes('WHALE'));
});

test('ranking outage degrades visibly to a deterministic prefix and never pretends to be a liquidity ranking', async () => {
  const m = market(300, 299, 'FAIL');
  const result = await discoverRealUniverse(m.alpaca, config(), () => NOW);
  assert.ok(result.blockers.includes('UNIVERSE_LIQUIDITY_PRERANK_UNAVAILABLE'));
  assert.equal(m.barSymbolRequests.flat().includes('WHALE'), false, 'without a ranking the whale is not magically included');
  assert.equal(result.funnel.stageDiagnostics?.find((stage) => stage.stage === 'SOURCE_ASSETS')?.providerState, 'PARTIAL');
});

test('a required bootstrap symbol survives the ranked bound even when it ranks poorly', async () => {
  const m = market(300, 299);
  await discoverRealUniverse(m.alpaca, config({ requiredSymbols: ['LOW5'] }), () => NOW);
  assert.ok(m.barSymbolRequests.flat().includes('LOW5') && m.barSymbolRequests.flat().includes('WHALE'));
});
