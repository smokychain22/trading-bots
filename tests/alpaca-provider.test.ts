import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AlpacaProviderError,
  fetchMasterAccountSnapshot,
  fetchMasterAccountEvidence,
  fetchMarketCalendar,
  fetchMarketClock,
  fetchLatestStockQuote,
  fetchLatestStockTrade,
  fetchOpenOrders,
  fetchOptionContract,
  fetchOptionContracts,
  fetchOptionSnapshots,
  fetchPositions,
  fetchStockBars,
  fetchTradableAssets,
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

test('Alpaca reads are abortable and release their deadline after a successful response', async () => {
  let suppliedSignal: AbortSignal | null = null;
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    suppliedSignal = init?.signal as AbortSignal | null;
    return jsonResponse(200, { status: 'ACTIVE' });
  }) as typeof fetch;
  await fetchMasterAccountSnapshot(baseConfig(fetchImpl), NOW);
  assert.ok(suppliedSignal instanceof AbortSignal);
  assert.equal(suppliedSignal.aborted, false);
});

test('a rejected client request is distinct from an Alpaca server failure', async () => {
  const rejected = (async () => new Response('', { status: 400 })) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(rejected), NOW), (error: unknown) => {
    assert.ok(error instanceof AlpacaProviderError);
    assert.equal(error.errorClass, 'INVALID_REQUEST');
    assert.equal(error.httpStatus, 400);
    return true;
  });
});

test('malformed broker numerics never become economic zero across account, contract, and quote boundaries', async () => {
  const accountFetch = (async () => jsonResponse(200, {
    status: 'ACTIVE', equity: ' ', cash: false, buying_power: '', options_buying_power: '12x',
    options_approved_level: '2',
  })) as typeof fetch;
  const account = await fetchMasterAccountSnapshot(baseConfig(accountFetch), NOW);
  assert.equal(account.equity, null);
  assert.equal(account.cash, null);
  assert.equal(account.buyingPower, null);
  assert.equal(account.optionsBuyingPower, null);
  assert.equal(account.optionsApprovedLevel, 2);

  const contractsFetch = (async () => jsonResponse(200, {
    option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09', size: ' ' }],
    next_page_token: null,
  })) as typeof fetch;
  const contracts = await fetchOptionContracts(baseConfig(contractsFetch), {
    underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01',
    optionType: 'put', limit: 10, maxPages: 2,
  });
  assert.equal(contracts.items[0]?.multiplier, null);

  const quotesFetch = (async () => jsonResponse(200, {
    snapshots: { SPY261009P00500000: {
      latestQuote: { bp: '', ap: '1.25', bs: false, as: '10', t: NOW },
      greeks: { delta: 'not-a-number' }, impliedVolatility: ' ', dailyBar: { v: '' },
    } }, next_page_token: null,
  })) as typeof fetch;
  const quotes = await fetchOptionSnapshots(baseConfig(quotesFetch), {
    underlyingSymbol: 'SPY', feed: 'indicative', optionType: 'put', limit: 10, maxPages: 2,
  });
  const quote = quotes.snapshots.get('SPY261009P00500000');
  assert.equal(quote?.bid, null);
  assert.equal(quote?.ask, 1.25);
  assert.equal(quote?.bidSize, null);
  assert.equal(quote?.askSize, 10);
  assert.equal(quote?.greeks?.delta, null);
  assert.equal(quote?.impliedVolatility, null);
  assert.equal(quote?.dailyVolume, null);
});

test('fetchPositions preserves a malformed quantity as UNKNOWN instead of zero', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    { symbol: 'AAPL', asset_class: 'us_equity', qty: 'not-a-number', side: 'long' },
  ])) as typeof fetch;
  const result = await fetchPositions(baseConfig(fetchImpl), NOW);
  assert.equal(result[0]?.quantity, null);
});

test('fetchPositions rejects a non-array response as MALFORMED_RESPONSE', async () => {
  const fetchImpl = (async () => jsonResponse(200, { not: 'an array' })) as typeof fetch;
  await assert.rejects(() => fetchPositions(baseConfig(fetchImpl), NOW));
});

test('fetchLatestStockTrade uses the market-data host and preserves a timestamped IEX reference', async () => {
  let requested = '';
  const fetchImpl = (async (request: string | URL | Request) => {
    requested = String(request);
    return jsonResponse(200, { trade: { p: 199.925, s: 40, t: NOW } });
  }) as typeof fetch;
  const result = await fetchLatestStockTrade(baseConfig(fetchImpl), 'AAPL', 'iex');
  assert.equal(new URL(requested).host, 'data.alpaca.markets');
  assert.equal(new URL(requested).pathname, '/v2/stocks/AAPL/trades/latest');
  assert.equal(new URL(requested).searchParams.get('feed'), 'iex');
  assert.deepEqual(result, { price: 199.925, size: 40, timestamp: NOW, feed: 'iex' });
});

test('account, clock, and latest stock quote reject malformed root objects with a provider category', async () => {
  const malformed = (async () => jsonResponse(200, null)) as typeof fetch;
  await assert.rejects(() => fetchMasterAccountSnapshot(baseConfig(malformed), NOW),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  await assert.rejects(() => fetchMarketClock(baseConfig(malformed), NOW),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  const malformedQuote = (async () => jsonResponse(200, { quote:'not-an-object' })) as typeof fetch;
  await assert.rejects(() => fetchLatestStockQuote(baseConfig(malformedQuote), 'SPY', 'iex'),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
});

test('fetchPositions rejects rows without a usable provider identity', async () => {
  for (const row of [null, {}, { symbol: '' }, { symbol: '   ' }]) {
    const fetchImpl = (async () => jsonResponse(200, [row])) as typeof fetch;
    await assert.rejects(() => fetchPositions(baseConfig(fetchImpl), NOW), (error: unknown) =>
      error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  }
});

test('fetchOpenOrders requests status=open and parses real-shaped orders', async () => {
  let requestedUrl = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requestedUrl = input instanceof URL ? input.toString() : String(input);
    return jsonResponse(200, [{ id: 'order-1', client_order_id: 'client-1', symbol: 'SPY261009P00500000', side: 'sell',
      position_intent: 'sell_to_open', qty: '1', filled_qty: '0', limit_price: '2.50', status: 'new', submitted_at: NOW }]);
  }) as typeof fetch;
  const result = await fetchOpenOrders(baseConfig(fetchImpl), NOW);
  assert.ok(requestedUrl.includes('status=open'));
  assert.equal(result[0]?.orderId, 'order-1');
  assert.equal(result[0]?.positionIntent, 'sell_to_open');
  assert.equal(result[0]?.filledQuantity, 0);
  assert.equal(result[0]?.limitPrice, 2.5);
});

test('fetchOpenOrders rejects rows without a usable provider order identity', async () => {
  for (const row of [null, {}, { id: '' }, { id: '   ' }]) {
    const fetchImpl = (async () => jsonResponse(200, [row])) as typeof fetch;
    await assert.rejects(() => fetchOpenOrders(baseConfig(fetchImpl), NOW), (error: unknown) =>
      error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  }
});

test('persistence account read shares bounded normalization and records actual response time',async()=>{
  let calls=0;
  const evidence=await fetchMasterAccountEvidence(baseConfig(async(_url,init)=>{
    assert.equal(init?.method,undefined);assert.ok(init?.signal);
    return jsonResponse(200,{id:'synthetic-id',equity:'',cash:false,buying_power:'0',options_trading_level:'2'});
  }),()=>calls++===0?NOW:'2026-09-10T15:00:03.000Z');
  assert.equal(evidence.providerAccountId,'synthetic-id');
  assert.equal(evidence.snapshot.receivedAt,'2026-09-10T15:00:03.000Z');
  assert.equal(evidence.snapshot.equity,null);assert.equal(evidence.snapshot.cash,null);
  assert.equal(evidence.snapshot.buyingPower,0);assert.equal(evidence.snapshot.optionsTradingLevel,2);
  assert.equal(Object.hasOwn(evidence.snapshot,'providerAccountId'),false);
});

test('persistence account read rejects missing identity and remains timeout bounded',async()=>{
  for(const id of [null,'',false])await assert.rejects(fetchMasterAccountEvidence(
    baseConfig(async()=>jsonResponse(200,{id})),()=>NOW),/MASTER_ACCOUNT_IDENTITY_UNKNOWN/);
  await assert.rejects(fetchMasterAccountEvidence({...baseConfig(async(_url,init)=>
    new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',
      ()=>reject(new DOMException('timeout','AbortError')),{once:true}))),requestTimeoutMs:20},()=>NOW),
    (error:unknown)=>error instanceof AlpacaProviderError&&error.errorClass==='PROVIDER_TIMEOUT');
});

test('open order enumeration uses bounded identity cursors without dropping tied timestamps', async () => {
  for (const count of [0, 1, 50, 500, 501, 1000, 1001]) {
    const rows = Array.from({ length: count }, (_, n) => ({ id: `order-${n}`, symbol: 'SPY', submitted_at: NOW }));
    let calls = 0;
    const fetchImpl: typeof fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.get('nested'), 'false');
      assert.equal(url.searchParams.get('direction'), 'desc');
      assert.equal(url.searchParams.has('until'), false);
      const offset = calls++ * 500;
      assert.equal(url.searchParams.get('before_order_id'), offset === 0 ? null : `order-${offset - 1}`);
      return jsonResponse(200, rows.slice(offset, offset + 500));
    };
    const result = await fetchOpenOrders(baseConfig(fetchImpl), NOW);
    assert.equal(result.length, count);
    assert.equal(calls, Math.floor(count / 500) + 1);
  }
});

test('open order pagination failures never return a falsely complete partial set', async () => {
  const page = Array.from({ length: 500 }, (_, n) => ({ id: `order-${n}`, symbol: 'SPY' }));
  await assert.rejects(fetchOpenOrders(baseConfig(async () => jsonResponse(200, page)), NOW), /CURSOR_REPEATED/);
  await assert.rejects(fetchOpenOrders(baseConfig(async () => jsonResponse(200, page)), NOW, { maxPages: 1 }), /PAGINATION_INCOMPLETE/);
  for (const maxPages of [0, -1, NaN, Infinity, 1.5]) {
    let calls = 0;
    await assert.rejects(fetchOpenOrders(baseConfig(async () => { calls++; return jsonResponse(200, []); }), NOW, { maxPages }), /PAGE_BOUND_INVALID/);
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(fetchOpenOrders(baseConfig(async () => jsonResponse(200, calls++ === 0 ? page
    : [{ id: 'order-499', symbol: 'QQQ' }])), NOW), /DUPLICATE_CONFLICT/);
  calls = 0;
  await assert.rejects(fetchOpenOrders(baseConfig(async () => calls++ === 0 ? jsonResponse(200, page)
    : jsonResponse(503, {})), NOW), (error: unknown) => error instanceof AlpacaProviderError && error.httpStatus === 503);
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

test('fetchOptionContracts parses the provider contract multiplier', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    option_contracts: [{ symbol: 'ADJ261009P00500000', strike_price: '500', expiration_date: '2026-10-09', size: '250' }],
    next_page_token: null,
  })) as typeof fetch;
  const result = await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'ADJ', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put', limit: 10, maxPages: 5 });
  assert.equal(result.items[0]?.multiplier, 250);
});

test('fetchOptionContracts preserves a missing multiplier as UNKNOWN', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    option_contracts: [{ symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' }],
    next_page_token: null,
  })) as typeof fetch;
  const result = await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'put', limit: 10, maxPages: 5 });
  assert.equal(result.items[0]?.multiplier, null);
});

test('fetchOptionContract resolves exact restart identity and multiplier without bounded-list omission', async () => {
  let requested = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return jsonResponse(200, {
      symbol: 'ADJ261009P00500000', type: 'put', strike_price: '500', expiration_date: '2026-10-09',
      size: '250', tradable: true, root_symbol: 'ADJ', underlying_symbol: 'ADJ', style: 'american',
      deliverables: [{ type: 'equity', symbol: 'ADJ', amount: '250', allocation_percentage: '100' }],
    });
  }) as typeof fetch;
  const result = await fetchOptionContract(baseConfig(fetchImpl), 'ADJ261009P00500000');
  assert.equal(new URL(requested).pathname, '/v2/options/contracts/ADJ261009P00500000');
  assert.equal(result.multiplier, 250);
  assert.deepEqual(result.deliverables,
    [{ type: 'equity', symbol: 'ADJ', amount: 250, allocationPercentage: 100 }]);
});

test('fetchOptionContract rejects mismatched identity and malformed type instead of lending metadata', async () => {
  const mismatch = (async () => jsonResponse(200, {
    symbol: 'OTHER261009P00500000', type: 'put', strike_price: '500', expiration_date: '2026-10-09', size: '100',
  })) as typeof fetch;
  await assert.rejects(() => fetchOptionContract(baseConfig(mismatch), 'SPY261009P00500000'),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  const malformedType = (async () => jsonResponse(200, {
    symbol: 'SPY261009P00500000', type: 'future', strike_price: '500', expiration_date: '2026-10-09', size: '100',
  })) as typeof fetch;
  await assert.rejects(() => fetchOptionContract(baseConfig(malformedType), 'SPY261009P00500000'),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
});

test('management contract fetch requests deliverables and preserves their exact coverage', async () => {
  let requested = '';
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009C00500000',
      strike_price: '500', expiration_date: '2026-10-09', size: '100', tradable: true,
      root_symbol: 'SPY', underlying_symbol: 'SPY', style: 'american',
      deliverables: [{ type: 'equity', symbol: 'SPY', amount: '100', allocation_percentage: '100' }],
    }], next_page_token: null });
  }) as typeof fetch;
  const result = await fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY',
    expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01', optionType: 'call',
    showDeliverables: true, limit: 10, maxPages: 2 });
  assert.equal(new URL(requested).searchParams.get('show_deliverables'), 'true');
  assert.deepEqual(result.items[0]?.deliverables,
    [{ type: 'equity', symbol: 'SPY', amount: 100, allocationPercentage: 100 }]);
});

test('a missing contract array is provider-malformed, while an explicit empty array is valid', async () => {
  const params = { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01',
    optionType: 'put' as const, limit: 10, maxPages: 2 };
  const missing = (async () => jsonResponse(200, { next_page_token: null })) as typeof fetch;
  await assert.rejects(() => fetchOptionContracts(baseConfig(missing), params), (error: unknown) =>
    error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  const empty = (async () => jsonResponse(200, { option_contracts: [], next_page_token: null })) as typeof fetch;
  assert.deepEqual((await fetchOptionContracts(baseConfig(empty), params)).items, []);
});

test('fetchOptionContracts marks complete=false (never silently complete) when maxPages is hit with more remaining, but preserves items already fetched', async () => {
  let page = 0;
  const fetchImpl = (async () => {
    page += 1;
    return jsonResponse(200, { option_contracts: [{ symbol: `X${page}`, strike_price: '1', expiration_date: '2026-10-09' }],
      next_page_token: `page-${page + 1}` });
  }) as typeof fetch;
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

test('option contract pagination remains complete across boundary sizes through 10,000 contracts', async () => {
  for (const count of [0, 1, 99, 100, 101, 999, 1000, 1001, 1090, 1511, 2000, 2601, 5000, 10000]) {
    let page = 0;
    const fetchImpl = (async () => {
      const start = page * 1000;
      const length = Math.max(0, Math.min(1000, count - start));
      page += 1;
      return jsonResponse(200, {
        option_contracts: Array.from({ length }, (_, offset) => ({
          symbol: `SPY261009P${String(500000 + start + offset).padStart(8, '0')}`,
          strike_price: String(500 + (start + offset) / 1000), expiration_date: '2026-10-09',
        })),
        next_page_token: start + length < count ? `page-${page}` : null,
      });
    }) as typeof fetch;
    const result = await fetchOptionContracts(baseConfig(fetchImpl), {
      underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01',
      optionType: 'put', limit: 1000, maxPages: 20,
    });
    assert.equal(result.complete, true, `count=${count}`);
    assert.equal(result.items.length, count, `count=${count}`);
    assert.equal(result.pagesFetched, Math.max(1, Math.ceil(count / 1000)), `count=${count}`);
  }
});

test('repeated or empty page tokens fail closed while identical contract rows deduplicate', async () => {
  const params = { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01',
    optionType: 'put' as const, limit: 1, maxPages: 10 };
  const row = { symbol: 'SPY261009P00500000', strike_price: '500', expiration_date: '2026-10-09' };
  for (const token of ['same', '']) {
    let requests = 0;
    const fetchImpl = (async () => {
      requests += 1;
      return jsonResponse(200, { option_contracts: [row], next_page_token: token });
    }) as typeof fetch;
    await assert.rejects(fetchOptionContracts(baseConfig(fetchImpl), params), (error: unknown) =>
      error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
    assert.ok(requests <= 2);
  }
  let page = 0;
  const duplicate = (async () => {
    page += 1;
    return jsonResponse(200, { option_contracts: [row], next_page_token: page === 1 ? 'p2' : null });
  }) as typeof fetch;
  const result=await fetchOptionContracts(baseConfig(duplicate), params);
  assert.equal(result.items.length,1);
  assert.equal(result.complete,true);
});

test('rate limit and server failure after a valid first contract page are not empty opportunities', async () => {
  const params = { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01', expirationDateLte: '2026-11-01',
    optionType: 'put' as const, limit: 1, maxPages: 10 };
  for (const [status, errorClass] of [[429, 'RATE_LIMITED'], [503, 'SERVER_ERROR']] as const) {
    let page = 0;
    const fetchImpl = (async () => {
      page += 1;
      return page === 1 ? jsonResponse(200, { option_contracts: [{ symbol: 'SPY261009P00500000',
        strike_price: '500', expiration_date: '2026-10-09' }], next_page_token: 'p2' })
        : jsonResponse(status, { message: 'provider failed' });
    }) as typeof fetch;
    await assert.rejects(fetchOptionContracts(baseConfig(fetchImpl), params), (error: unknown) =>
      error instanceof AlpacaProviderError && error.errorClass === errorClass);
  }
});

test('fetchOptionSnapshots rejects malformed optional nested objects instead of fabricating an empty snapshot', async () => {
  const params = { underlyingSymbol: 'SPY', feed: 'indicative' as const,
    optionType: 'put' as const, limit: 10, maxPages: 2 };
  for (const snapshot of [
    { latestQuote: 'malformed' },
    { latestQuote: null, greeks: [] },
    { latestQuote: null, dailyBar: 7 },
  ]) {
    const fetchImpl = (async () => jsonResponse(200, {
      snapshots: { SPY261009P00500000: snapshot }, next_page_token: null,
    })) as typeof fetch;
    await assert.rejects(() => fetchOptionSnapshots(baseConfig(fetchImpl), params),
      (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  }
});

test('fetchOptionSnapshots forwards bounded management lattice filters and rejects malformed dates locally',async()=>{
  let query:URLSearchParams|null=null;
  const fetchImpl=(async(input:RequestInfo|URL)=>{
    query=new URL(input instanceof URL?input.toString():String(input)).searchParams;
    return jsonResponse(200,{snapshots:{},next_page_token:null});
  }) as typeof fetch;
  await fetchOptionSnapshots(baseConfig(fetchImpl),{underlyingSymbol:'AAPL',feed:'indicative',optionType:'call',
    expirationDateGte:'2026-09-22',expirationDateLte:'2026-12-21',strikePriceGte:100,
    strikePriceLte:300,limit:1000,maxPages:2});
  assert.equal((query as URLSearchParams|null)?.get('expiration_date_gte'),'2026-09-22');
  assert.equal((query as URLSearchParams|null)?.get('expiration_date_lte'),'2026-12-21');
  assert.equal((query as URLSearchParams|null)?.get('strike_price_gte'),'100');
  assert.equal((query as URLSearchParams|null)?.get('strike_price_lte'),'300');
  await assert.rejects(()=>fetchOptionSnapshots(baseConfig(fetchImpl),{underlyingSymbol:'AAPL',feed:'indicative',
    optionType:'call',expirationDateGte:'2026-02-30',limit:1000,maxPages:2}),/OPTION_SNAPSHOT_FILTER_INVALID/);
});

test('a missing snapshot map is provider-malformed, while an explicit empty map is valid', async () => {
  const params = { underlyingSymbol: 'SPY', feed: 'indicative' as const,
    optionType: 'put' as const, limit: 10, maxPages: 2 };
  const missing = (async () => jsonResponse(200, { next_page_token: null })) as typeof fetch;
  await assert.rejects(() => fetchOptionSnapshots(baseConfig(missing), params), (error: unknown) =>
    error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  const empty = (async () => jsonResponse(200, { snapshots: {}, next_page_token: null })) as typeof fetch;
  assert.equal((await fetchOptionSnapshots(baseConfig(empty), params)).snapshots.size, 0);
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

test('fetchOptionContracts rejects a missing strike instead of fabricating a zero-priced contract', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    option_contracts: [{ symbol: 'SPY261009P00500000', expiration_date: '2026-10-09' }],
    next_page_token: null,
  })) as typeof fetch;
  await assert.rejects(
    fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-10-01',
      expirationDateLte: '2026-11-01', optionType: 'put', limit: 10, maxPages: 5 }),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE',
  );
});

test('fetchLatestStockQuote uses the market-data host, explicit feed, and preserves two-sided timestamped evidence', async () => {
  let requested = '';
  const fetchImpl = (async (request: string | URL | Request) => {
    requested = String(request);
    return jsonResponse(200, { quote: { bp: 199.91, ap: 199.94, bs: 8, as: 11, t: NOW } });
  }) as typeof fetch;
  const result = await fetchLatestStockQuote(baseConfig(fetchImpl), 'AAPL', 'iex');
  assert.equal(new URL(requested).host, 'data.alpaca.markets');
  assert.equal(new URL(requested).pathname, '/v2/stocks/AAPL/quotes/latest');
  assert.equal(new URL(requested).searchParams.get('feed'), 'iex');
  assert.deepEqual(result, { bid: 199.91, ask: 199.94, bidSize: 8, askSize: 11, timestamp: NOW, feed: 'iex' });
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

test('fetchStockBars marks the dataset INCOMPLETE when maxPages is reached without inflating duplicate bars', async () => {
  let page=0;
  const fetchImpl = (async () => jsonResponse(200, { bars: { SPY: [{ t: NOW, o: 1, h: 1, l: 1, c: 1, v: 1 }] }, next_page_token: `more-${++page}` })) as typeof fetch;
  const result = await fetchStockBars(
    baseConfig(fetchImpl),
    { symbols: ['SPY'], timeframe: '1Day', start: '2026-09-01T00:00:00Z', end: '2026-09-10T00:00:00Z', feed: 'iex', maxPages: 2, adjustment: 'raw' },
    NOW,
  );
  assert.equal(result.complete, false);
  assert.equal(result.bars.length, 1); // identical evidence is represented once
});

test('fetchStockBars classifies a malformed bar as a provider response error', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    bars: { SPY: [{ t: NOW, o: false, h: 2, l: 0.5, c: 1.5, v: 100 }] }, next_page_token: null,
  })) as typeof fetch;
  await assert.rejects(() => fetchStockBars(baseConfig(fetchImpl), {
    symbols: ['SPY'], timeframe: '1Day', start: '2026-09-01T00:00:00Z', end: NOW,
    feed: 'iex', maxPages: 2, adjustment: 'raw',
  }, NOW), (error: unknown) => error instanceof AlpacaProviderError
    && error.errorClass === 'MALFORMED_RESPONSE' && error.safeDetailCode === 'ALPACA_BARS_MALFORMED_OHLC');
});

test('fetchStockBars keeps valid OHLCV when provider optional VWAP is zero and reports its loss', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    bars: { SPY: [{ t: NOW, o: 100, h: 102, l: 99, c: 101, v: 500, vw: 0 }] }, next_page_token: null,
  })) as typeof fetch;
  const result = await fetchStockBars(baseConfig(fetchImpl), {
    symbols: ['SPY'], timeframe: '1Day', start: '2026-09-01T00:00:00Z', end: NOW,
    feed: 'iex', maxPages: 2, adjustment: 'raw',
  }, NOW);
  assert.equal(result.complete, true);
  assert.equal(result.bars[0]?.close, 101);
  assert.equal(result.bars[0]?.vwap, null);
  assert.equal(result.bars[0]?.vwapSourceState, 'PROVIDER_ZERO_UNAVAILABLE');
  assert.equal(result.providerZeroVwapCount, 1);
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

test('fetchMarketCalendar parses a session correctly', async () => {
  const fetchImpl = (async () => jsonResponse(200, [{ date: '2026-09-10', open: '09:30', close: '16:00', session_open: '04:00', session_close: '20:00' }])) as typeof fetch;
  const sessions = await fetchMarketCalendar(baseConfig(fetchImpl), '2026-09-10', '2026-09-10');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.date, '2026-09-10');
  assert.equal(sessions[0]?.open, '09:30');
  assert.equal(sessions[0]?.close, '16:00');
});

test('fetchMarketCalendar rejects a non-array body rather than silently returning nothing', async () => {
  const fetchImpl = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
  await assert.rejects(() => fetchMarketCalendar(baseConfig(fetchImpl), '2026-09-10', '2026-09-10'), AlpacaProviderError);
});

test('fetchTradableAssets filters to tradable=true only and reports complete=true when under the bound', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    { symbol: 'SPY', exchange: 'ARCA', class: 'us_equity', tradable: true, status: 'active', fractionable: true },
    { symbol: 'NOTRADE', exchange: 'OTC', class: 'us_equity', tradable: false, status: 'active', fractionable: false },
  ])) as typeof fetch;
  const result = await fetchTradableAssets(baseConfig(fetchImpl), 100);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0]?.symbol, 'SPY');
  assert.equal(result.complete, true);
});

test('fetchTradableAssets truncates deterministically and reports complete=false when the real universe exceeds maxAssets -- never silently drops without saying so', async () => {
  const fetchImpl = (async () => jsonResponse(200, Array.from({ length: 5 }, (_, i) => ({ symbol: `SYM${i}`, exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active', fractionable: false })))) as typeof fetch;
  const result = await fetchTradableAssets(baseConfig(fetchImpl), 3);
  assert.equal(result.assets.length, 3);
  assert.equal(result.complete, false);
});

test('snapshot pagination rejects repeated tokens and deduplicates identical exact-contract quotes', async () => {
  const params = { underlyingSymbol: 'SPY', feed: 'indicative' as const,
    optionType: 'put' as const, limit: 1, maxPages: 5 };
  let tokenPage = 0;
  const repeatedToken = (async () => {
    tokenPage += 1;
    return jsonResponse(200, { snapshots: { [String(tokenPage)]: { latestQuote: { bp: 1, ap: 1.1 } } },
      next_page_token: 'same' });
  }) as typeof fetch;
  await assert.rejects(fetchOptionSnapshots(baseConfig(repeatedToken), params), (error: unknown) =>
    error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  let duplicatePage = 0;
  const duplicate = (async () => {
    duplicatePage += 1;
    return jsonResponse(200, { snapshots: { SPY261009P00500000: { latestQuote: { bp: 1, ap: 1.1 } } },
      next_page_token: duplicatePage === 1 ? 'p2' : null });
  }) as typeof fetch;
  const result=await fetchOptionSnapshots(baseConfig(duplicate),params);
  assert.equal(result.snapshots.size,1);
  assert.equal(result.complete,true);
});

test('fetchOptionContracts rejects an impossible expiration date instead of accepting a shaped string', async () => {
  const fetchImpl = (async () => jsonResponse(200, {
    option_contracts: [{ symbol: 'SPY260230P00500000', strike_price: '500', expiration_date: '2026-02-30' }],
    next_page_token: null,
  })) as typeof fetch;
  await assert.rejects(
    fetchOptionContracts(baseConfig(fetchImpl), { underlyingSymbol: 'SPY', expirationDateGte: '2026-02-01',
      expirationDateLte: '2026-03-31', optionType: 'put', limit: 10, maxPages: 5 }),
    (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE',
  );
});

test('fetchMarketCalendar rejects malformed rows instead of creating an empty session identity', async () => {
  for (const row of [null, {}, { date: '' }, { date: '2026-02-30' }]) {
    const fetchImpl = (async () => jsonResponse(200, [row])) as typeof fetch;
    await assert.rejects(() => fetchMarketCalendar(baseConfig(fetchImpl), '2026-09-10', '2026-09-10'),
      (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  }
});

test('fetchTradableAssets retains an explicitly required tradable symbol beyond the client bound', async () => {
  const fetchImpl = (async () => jsonResponse(200, [
    ...Array.from({ length: 5 }, (_, i) => ({ symbol: `SYM${i}`, exchange: 'NASDAQ', class: 'us_equity', tradable: true, status: 'active' })),
    { symbol: 'SPY', exchange: 'ARCA', class: 'us_equity', tradable: true, status: 'active' },
  ])) as typeof fetch;
  const result = await fetchTradableAssets(baseConfig(fetchImpl), 3, ['spy']);
  assert.equal(result.complete, false);
  assert.deepEqual(result.assets.map((asset) => asset.symbol), ['SYM0', 'SYM1', 'SYM2', 'SPY']);
});

test('fetchTradableAssets rejects a non-array body', async () => {
  const fetchImpl = (async () => jsonResponse(200, {})) as typeof fetch;
  await assert.rejects(() => fetchTradableAssets(baseConfig(fetchImpl), 10), AlpacaProviderError);
});

test('fetchTradableAssets rejects anonymous tradable rows instead of consuming a universe slot', async () => {
  for (const row of [null, { tradable: true }, { symbol: '', tradable: true }, { symbol: '   ', tradable: true }]) {
    const fetchImpl = (async () => jsonResponse(200, [row])) as typeof fetch;
    await assert.rejects(() => fetchTradableAssets(baseConfig(fetchImpl), 10),
      (error: unknown) => error instanceof AlpacaProviderError && error.errorClass === 'MALFORMED_RESPONSE');
  }
});
