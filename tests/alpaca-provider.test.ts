import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AlpacaProviderError,
  fetchMasterAccountSnapshot,
  fetchMarketClock,
  fetchOpenOrders,
  fetchOptionContracts,
  fetchOptionSnapshots,
  fetchPositions,
  fetchStockBars,
  type AlpacaProviderConfig,
} from '../src/theta/alpaca-provider.js';

// All tests use an injected fetchImpl -- NEVER live network, never real
// credentials. Test credentials below are obvious synthetic placeholders.

const NOW = '2026-09-10T15:00:00.000Z';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const baseConfig = (fetchImpl: typeof fetch): AlpacaProviderConfig => ({
  tradingApiBase: 'https://paper-api.alpaca.markets',
  marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: 'TEST-SYNTHETIC-KEY-0000',
  apiSecret: 'TEST-SYNTHETIC-SECRET-0000',
  fetchImpl,
});

test('fetchMasterAccountSnapshot parses account fields, including options buying power and level', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    id: 'abcd-1234-real-account-id', status: 'ACTIVE', equity: '100000.00', cash: '50000.00',
    buying_power: '40000.00', options_buying_power: '20000.00', options_approved_level: 2,
    options_trading_level: 2, trading_blocked: false, transfers_blocked: false,
  })) as typeof fetch;
  const result = await fetchMasterAccountSnapshot(baseConfig(fetchImpl), NOW);
  assert.equal(result.accountStatus, 'ACTIVE');
  assert.equal(result.equity, 100000);
  assert.equal(result.optionsBuyingPower, 20000);
  assert.equal(result.optionsApprovedLevel, 2);
  assert.equal(result.maskedAccountId, '••••t-id'); // never the raw account id
});

test('fetchMasterAccountSnapshot never fabricates a missing field -- UNKNOWN stays null', async () => {
  const fetchImpl = (async () => jsonResponse(200, { status: 'ACTIVE' })) as typeof fetch;
  const result = await fetchMasterAccountSnapshot(baseConfig(fetchImpl), NOW);
  assert.equal(result.equity, null);
  assert.equal(result.optionsBuyingPower, null);
  assert.equal(result.tradingBlocked, null);
});

test('401 is classified INVALID_AUTH, 403 is classified NOT_ENTITLED -- never silently swallowed', async () => {
  const unauthorized = (async () => new Response('', { status: 401 })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(unauthorized), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'INVALID_AUTH');
    return true;
  });

  const forbidden = (async () => new Response('', { status: 403 })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(forbidden), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'NOT_ENTITLED');
    return true;
  });
});

test('429 is classified RATE_LIMITED, 5xx is classified SERVER_ERROR', async () => {
  const rateLimited = (async () => new Response('', { status: 429 })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(rateLimited), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'RATE_LIMITED');
    return true;
  });
  const serverError = (async () => new Response('', { status: 503 })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(serverError), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'SERVER_ERROR');
    return true;
  });
});

test('a network failure is classified NETWORK_ERROR, never silently treated as a valid empty response', async () => {
  const failing = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(failing), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'NETWORK_ERROR');
    return true;
  });
});

test('a non-JSON body is classified MALFORMED_RESPONSE, never crashes uncaught', async () => {
  const badBody = (async () => new Response('not json{{{', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(badBody), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'MALFORMED_RESPONSE');
    return true;
  });
});

test('an AlpacaProviderError message never includes the configured credential values', async () => {
  const unauthorized = (async () => new Response('', { status: 401 })) as typeof fetch;
  try {
    await fetchMasterAccountSnapshot(baseConfig(unauthorized), NOW);
    assert.fail('expected rejection');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(!message.includes('TEST-SYNTHETIC-KEY-0000'));
    assert.ok(!message.includes('TEST-SYNTHETIC-SECRET-0000'));
  }
});

test('fetchPositions parses a real-shaped positions array', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    { symbol: 'AAPL', asset_class: 'us_equity', qty: '100', side: 'long', avg_entry_price: '150.00', market_value: '15500.00', unrealized_pl: '500.00' },
  ])) as typeof fetch;
  const result = await fetchPositions(baseConfig(fetchImpl), NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.symbol, 'AAPL');
  assert.equal(result[0]?.quantity, 100);
});

test('fetchPositions rejects a non-array response as MALFORMED_RESPONSE', async () => {
  const fetchImpl = (async () => jsonResponse(200, { not: 'an array' })) as typeof fetch;
  await assert.rejects(() => fetchPositions(baseConfig(fetchImpl), NOW));
});

test('fetchOpenOrders requests status=open and parses real-shaped orders', async () => {
  let requestedUrl = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedUrl = input instanceof URL ? input.toString() : String(input);
    return jsonResponse(200, [{ id: 'order-1', client_order_id: 'client-1', symbol: 'SPY', side: 'sell', qty: '1', status: 'new', submitted_at: NOW }]);
  }) as typeof fetch;
  const result = await fetchOpenOrders(baseConfig(fetchImpl), NOW);
  assert.ok(requestedUrl.includes('status=open'));
  assert.equal(result[0]?.orderId, 'order-1');
});

test('fetchMarketClock parses timestamp/isOpen', async () => {
  const fetchImpl = (async () => jsonResponse(200, { timestamp: NOW, is_open: true, next_open: NOW, next_close: NOW })) as typeof fetch;
  const result = await fetchMarketClock(baseConfig(fetchImpl), NOW);
  assert.equal(result.isOpen, true);
});

test('fetchOptionContracts uses the TRADING API host, not the market-data host', async () => {
  let requestedHost = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedHost = new URL(input instanceof URL ? input.toString() : String(input)).host;
    return jsonResponse(200, { option_contracts: [], next_page_token: null });
  }) as typeof fetch;
  await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put', limit: 10, maxPages: 5 });
  assert.equal(requestedHost, 'paper-api.alpaca.markets');
});

test('fetchOptionContracts follows next_page_token to completion, never assuming one HTTP 200 is the full chain', async () => {
  const pages = [
    { option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }], next_page_token: 'p2' },
    { option_contracts: [{ symbol: 'SPY261009P00505000', strike_price: '505', expiration_date: '2026-10-09' }], next_page_token: null },
  ];
  let call = 0;
  const fetchImpl = (async () => { const page = pages[call]; call += 1; return jsonResponse(200, page); }) as typeof fetch;
  const result = await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put', limit: 1, maxPages: 5 });
  assert.equal(result.complete, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.pagesFetched, 2);
});

test('fetchOptionContracts marks complete=false (never silently complete) when maxPages is hit with more remaining, but preserves items already fetched', async () => {
  const fetchImpl = (async () => jsonResponse(200, { option_contracts: [{ symbol: 'X', strike_price: '1', expiration_date: '2026-10-09' }], next_page_token: 'always-more' })) as typeof fetch;
  const result = await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put', limit: 1, maxPages: 2 });
  assert.equal(result.complete, false);
  assert.equal(result.items.length, 2);
});

test('fetchOptionSnapshots uses the MARKET DATA host and preserves feed/Greeks/quote shape', async () => {
  let requestedHost = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedHost = new URL(input instanceof URL ? input.toString() : String(input)).host;
    return jsonResponse(200, {
      snapshots: {
        SPY261009P00500000: {
          latestQuote: { bp: 0.11, ap: 0.12, bs: 900, as: 900, t: NOW },
          greeks: { delta: -0.003, gamma: 0.0001, theta: -0.02, vega: 0.02, rho: -0.002 },
          impliedVolatility: 0.5,
          dailyBar: { v: 5 },
        },
      },
      next_page_token: null,
    });
  }) as typeof fetch;
  const result = await fetchOptionSnapshots(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', feed: 'indicative', optionType: 'put', limit: 10, maxPages: 5 });
  assert.equal(requestedHost, 'data.alpaca.markets');
  assert.equal(result.complete, true);
  const snapshot = result.snapshots.get('SPY261009P00500000');
  assert.equal(snapshot?.bid, 0.11);
  assert.equal(snapshot?.greeks?.delta, -0.003);
  assert.equal(snapshot?.dailyVolume, 5);
});

test('fetchOptionSnapshots preserves a missing Greeks object as null, never fabricated', async () => {
  const fetchImpl = (async () => jsonResponse(200, { snapshots: { X: { latestQuote: { bp: 1, ap: 1.1 } } }, next_page_token: null })) as typeof fetch;
  const result = await fetchOptionSnapshots(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', feed: 'indicative', optionType: 'put', limit: 10, maxPages: 5 });
  assert.equal(result.snapshots.get('X')?.greeks, null);
});

test('fetchOptionSnapshots: the best contract residing on a LATER page is still discovered -- page 1 alone would miss it', async () => {
  const pages = [
    { snapshots: { WORSE: { latestQuote: { bp: 0.05, ap: 0.06 } } }, next_page_token: 'p2' },
    { snapshots: { BEST: { latestQuote: { bp: 0.5, ap: 0.51 } } }, next_page_token: null },
  ];
  let call = 0;
  const fetchImpl = (async () => { const page = pages[call]; call += 1; return jsonResponse(200, page); }) as typeof fetch;
  const result = await fetchOptionSnapshots(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', feed: 'indicative', optionType: 'put', limit: 1, maxPages: 5 });
  assert.equal(result.complete, true);
  assert.ok(result.snapshots.has('BEST'));
  assert.ok(result.snapshots.has('WORSE'));
});

test('fetchOptionSnapshots marks complete=false when maxPages is hit with more remaining, but preserves snapshots already fetched', async () => {
  const fetchImpl = (async () => jsonResponse(200, { snapshots: { X: { latestQuote: { bp: 1, ap: 1.1 } } }, next_page_token: 'always-more' })) as typeof fetch;
  const result = await fetchOptionSnapshots(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', feed: 'indicative', optionType: 'put', limit: 1, maxPages: 1 });
  assert.equal(result.complete, false);
  assert.equal(result.snapshots.size, 1);
});

test('fetchStockBars follows next_page_token across pages, including a first page containing only one symbol of a multi-symbol request', async () => {
  const pages = [
    { bars: { SPY: [{ t: '2026-09-01T00:00:00Z', o: 500, h: 501, l: 499, c: 500.5, v: 1000 }] }, next_page_token: 'p2' }, // QQQ absent from page 1
    { bars: { QQQ: [{ t: '2026-09-01T00:00:00Z', o: 400, h: 401, l: 399, c: 400.5, v: 900 }] }, next_page_token: null },
  ];
  let call = 0;
  const fetchImpl = (async () => { const page = pages[call]; call += 1; return jsonResponse(200, page); }) as typeof fetch;
  const result = await fetchStockBars(
    baseConfig(fetchImpl),
    { symbols: ['SPY', 'QQQ'], timeframe: '1Day', start: '2026-09-01T00:00:00Z', end: '2026-09-10T00:00:00Z', feed: 'iex', maxPages: 10, adjustment: 'raw' },
    NOW,
  );
  assert.equal(result.complete, true);
  assert.equal(result.bars.length, 2);
  assert.ok(result.bars.some((b) => b.symbol === 'SPY'));
  assert.ok(result.bars.some((b) => b.symbol === 'QQQ'));
});

test('fetchStockBars marks the dataset INCOMPLETE (never silently complete) when maxPages is hit with more remaining, but keeps the bars already fetched', async () => {
  const fetchImpl = (async () => jsonResponse(200, { bars: { SPY: [{ t: NOW, o: 1, h: 1, l: 1, c: 1, v: 1 }] }, next_page_token: 'always-more' })) as typeof fetch;
  const result = await fetchStockBars(
    baseConfig(fetchImpl),
    { symbols: ['SPY'], timeframe: '1Day', start: '2026-09-01T00:00:00Z', end: '2026-09-10T00:00:00Z', feed: 'iex', maxPages: 2, adjustment: 'raw' },
    NOW,
  );
  assert.equal(result.complete, false);
  assert.equal(result.bars.length, 2); // bars from both attempted pages are preserved, never discarded
});

test('fetchStockBars request includes the explicit adjustment parameter -- never silently mixed', async () => {
  let requestedUrl = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedUrl = input instanceof URL ? input.toString() : String(input);
    return jsonResponse(200, { bars: {}, next_page_token: null });
  }) as typeof fetch;
  await fetchStockBars(baseConfig(fetchImpl), { symbols: ['SPY'], timeframe: '1Day', start: NOW, end: NOW, feed: 'iex', maxPages: 5, adjustment: 'split' }, NOW);
  assert.ok(requestedUrl.includes('adjustment=split'));
});
