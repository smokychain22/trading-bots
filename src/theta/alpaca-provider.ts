import { parseAlpacaBarsPage, type FetchHistoricalBarsParams, type HistoricalBar, type RawAlpacaBarsPage } from './underlying-history.js';
import type { AlpacaOptionContractListing, AlpacaOptionSnapshot } from './option-chain-ingestion.js';

// R1B production Alpaca provider service: typed, canonical accessors over
// the real Alpaca Trading API and Market Data API. This module owns HOST
// SELECTION explicitly (Trading API base vs. Market Data API base are two
// different hosts and must never be conflated by blindly concatenating one
// base URL) -- callers never choose a host themselves.
//
// Credentials are consumed ONLY via AlpacaProviderConfig, which the caller
// builds from environment variables (ALPACA_API_KEY / ALPACA_SECRET_KEY /
// ALPACA_BASE_URL) -- this module never reads process.env itself, never
// logs a header, and every error path here redacts before returning (see
// AlpacaProviderError below). `fetchImpl` is injectable so every function
// here is testable with a mock, never live network, in automated tests.

export interface AlpacaProviderConfig {
  readonly tradingApiBase: string; // e.g. https://paper-api.alpaca.markets -- account/positions/orders/contracts
  readonly marketDataApiBase: string; // e.g. https://data.alpaca.markets -- quotes/snapshots/bars
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly fetchImpl?: typeof fetch;
}

const authHeaders = (config: AlpacaProviderConfig): HeadersInit => ({
  'APCA-API-KEY-ID': config.apiKey,
  'APCA-API-SECRET-KEY': config.apiSecret,
});

export type AlpacaErrorClass = 'INVALID_REQUEST' | 'INVALID_AUTH' | 'NOT_ENTITLED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'PROVIDER_TIMEOUT' | 'MALFORMED_RESPONSE';

export class AlpacaProviderError extends Error {
  readonly errorClass: AlpacaErrorClass;
  readonly httpStatus: number | null;
  readonly safeDetailCode: string | null;
  constructor(errorClass: AlpacaErrorClass, httpStatus: number | null, message: string, safeDetailCode: string | null = null) {
    super(message); // message never includes header/credential content -- see call sites below
    this.name = 'AlpacaProviderError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
    this.safeDetailCode = safeDetailCode;
  }
}

const classifyErrorStatus = (status: number): AlpacaErrorClass => {
  if (status === 401 || status === 403) return status === 403 ? 'NOT_ENTITLED' : 'INVALID_AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'INVALID_REQUEST';
};

async function requestJson(fetchImpl: typeof fetch, url: URL, headers: HeadersInit): Promise<unknown> {
  // Read-only market/broker calls must finish inside the bounded serverless
  // evidence cycle. A stalled read is provider uncertainty, never empty data.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new AlpacaProviderError(classifyErrorStatus(response.status), response.status, `${url.pathname} returned HTTP ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) throw new AlpacaProviderError('PROVIDER_TIMEOUT', null, `${url.pathname} read timed out.`);
      throw new AlpacaProviderError('MALFORMED_RESPONSE', response.status, `${url.pathname} returned a non-JSON body.`);
    }
  } catch (error) {
    if (error instanceof AlpacaProviderError) throw error;
    if (controller.signal.aborted) throw new AlpacaProviderError('PROVIDER_TIMEOUT', null, `${url.pathname} read timed out.`);
    throw new AlpacaProviderError('NETWORK_ERROR', null, `Network error reaching ${url.host}${url.pathname} -- ${error instanceof Error ? error.name : 'unknown'}.`);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Master account snapshot
// ---------------------------------------------------------------------------

export interface MasterAccountSnapshot {
  readonly accountStatus: string | null;
  readonly equity: number | null;
  readonly cash: number | null;
  readonly buyingPower: number | null;
  readonly optionsBuyingPower: number | null;
  readonly optionsApprovedLevel: number | null;
  readonly optionsTradingLevel: number | null;
  readonly tradingBlocked: boolean | null;
  readonly transfersBlocked: boolean | null;
  readonly maskedAccountId: string | null;
  readonly receivedAt: string;
}

const asNumberOrNull = (value: unknown): number | null => {
  // Broker numeric fields can be JSON numbers or decimal strings. Number('')
  // and Number(false) both produce zero, which would turn malformed provider
  // evidence into a purported economic fact. Preserve those as UNKNOWN.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const asBooleanOrNull = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const nonEmptyString = (value: unknown): string | null => {
  const parsed = asStringOrNull(value)?.trim() ?? '';
  return parsed.length > 0 ? parsed : null;
};
const providerRow = (value: unknown, operation: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', null, `${operation} returned a malformed row.`);
  }
  return value as Record<string, unknown>;
};

export async function fetchMasterAccountSnapshot(config: AlpacaProviderConfig, receivedAt: string): Promise<MasterAccountSnapshot> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = providerRow(await requestJson(fetchImpl, new URL('/v2/account', config.tradingApiBase), authHeaders(config)), '/v2/account');
  const accountId = asStringOrNull(body.id);
  return {
    accountStatus: asStringOrNull(body.status),
    equity: asNumberOrNull(body.equity),
    cash: asNumberOrNull(body.cash),
    buyingPower: asNumberOrNull(body.buying_power),
    optionsBuyingPower: asNumberOrNull(body.options_buying_power),
    optionsApprovedLevel: asNumberOrNull(body.options_approved_level),
    optionsTradingLevel: asNumberOrNull(body.options_trading_level),
    tradingBlocked: asBooleanOrNull(body.trading_blocked),
    transfersBlocked: asBooleanOrNull(body.transfers_blocked),
    maskedAccountId: accountId !== null ? `••••${accountId.slice(-4)}` : null,
    receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface AlpacaPositionSnapshot {
  readonly symbol: string;
  readonly assetClass: string | null;
  readonly quantity: number | null;
  readonly side: string | null;
  readonly avgEntryPrice: number | null;
  readonly marketValue: number | null;
  readonly unrealizedPl: number | null;
  readonly receivedAt: string;
}

export async function fetchPositions(config: AlpacaProviderConfig, receivedAt: string): Promise<readonly AlpacaPositionSnapshot[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = await requestJson(fetchImpl, new URL('/v2/positions', config.tradingApiBase), authHeaders(config));
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/positions did not return an array.');
  return body.map((value) => {
    const raw = providerRow(value, '/v2/positions');
    const symbol = nonEmptyString(raw.symbol);
    if (symbol === null) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/positions returned a row without identity.');
    return {
      symbol,
      assetClass: asStringOrNull(raw.asset_class),
      quantity: asNumberOrNull(raw.qty),
      side: asStringOrNull(raw.side),
      avgEntryPrice: asNumberOrNull(raw.avg_entry_price),
      marketValue: asNumberOrNull(raw.market_value),
      unrealizedPl: asNumberOrNull(raw.unrealized_pl),
      receivedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Open orders
// ---------------------------------------------------------------------------

export interface AlpacaOpenOrderSnapshot {
  readonly orderId: string;
  readonly clientOrderId: string | null;
  readonly symbol: string | null;
  readonly side: string | null;
  readonly positionIntent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close' | null;
  readonly quantity: number | null;
  readonly limitPrice: number | null;
  readonly status: string | null;
  readonly submittedAt: string | null;
  readonly receivedAt: string;
}

export async function fetchOpenOrders(config: AlpacaProviderConfig, receivedAt: string): Promise<readonly AlpacaOpenOrderSnapshot[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL('/v2/orders', config.tradingApiBase);
  url.search = new URLSearchParams({ status: 'open' }).toString();
  const body = await requestJson(fetchImpl, url, authHeaders(config));
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/orders did not return an array.');
  return body.map((value) => {
    const raw = providerRow(value, '/v2/orders');
    const orderId = nonEmptyString(raw.id);
    if (orderId === null) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/orders returned a row without identity.');
    return {
      orderId,
      clientOrderId: nonEmptyString(raw.client_order_id),
      symbol: nonEmptyString(raw.symbol),
      side: nonEmptyString(raw.side),
      positionIntent: (() => {
        const positionIntent = nonEmptyString(raw.position_intent);
        return positionIntent === 'buy_to_open' || positionIntent === 'buy_to_close'
          || positionIntent === 'sell_to_open' || positionIntent === 'sell_to_close'
          ? positionIntent : null;
      })(),
      quantity: asNumberOrNull(raw.qty),
      limitPrice: asNumberOrNull(raw.limit_price),
      status: nonEmptyString(raw.status),
      submittedAt: nonEmptyString(raw.submitted_at),
      receivedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Market clock
// ---------------------------------------------------------------------------

export interface AlpacaMarketClock {
  readonly timestamp: string | null;
  readonly isOpen: boolean | null;
  readonly nextOpen: string | null;
  readonly nextClose: string | null;
  readonly receivedAt: string;
}

export async function fetchMarketClock(config: AlpacaProviderConfig, receivedAt: string): Promise<AlpacaMarketClock> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = providerRow(await requestJson(fetchImpl, new URL('/v2/clock', config.tradingApiBase), authHeaders(config)), '/v2/clock');
  return {
    timestamp: asStringOrNull(body.timestamp),
    isOpen: asBooleanOrNull(body.is_open),
    nextOpen: asStringOrNull(body.next_open),
    nextClose: asStringOrNull(body.next_close),
    receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Market calendar
// ---------------------------------------------------------------------------

export interface AlpacaCalendarSession {
  readonly date: string; // YYYY-MM-DD
  readonly open: string | null; // HH:MM, exchange-local per Alpaca's documented format
  readonly close: string | null;
  readonly sessionOpen: string | null; // pre-market session open, when documented/present
  readonly sessionClose: string | null; // post-market session close, when documented/present
}

export async function fetchMarketCalendar(config: AlpacaProviderConfig, start: string, end: string): Promise<readonly AlpacaCalendarSession[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL('/v2/calendar', config.tradingApiBase);
  url.search = new URLSearchParams({ start, end }).toString();
  const body = await requestJson(fetchImpl, url, authHeaders(config));
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/calendar did not return an array.');
  return body.map((value) => {
    const raw = providerRow(value, '/v2/calendar');
    const date = nonEmptyString(raw.date);
    const dateMs = date === null ? NaN : Date.parse(`${date}T00:00:00.000Z`);
    if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/calendar returned a row without a valid session date.');
    }
    return {
      date,
      open: nonEmptyString(raw.open),
      close: nonEmptyString(raw.close),
      sessionOpen: nonEmptyString(raw.session_open),
      sessionClose: nonEmptyString(raw.session_close),
    };
  });
}

// ---------------------------------------------------------------------------
// Tradable asset universe (Stage 1 cheap screen source -- see
// universe-discovery.ts, which is the only intended caller of this
// function; it is NOT an option-chain call and carries no per-symbol
// optionability information, only Alpaca's own asset registry facts).
// ---------------------------------------------------------------------------

export interface AlpacaTradableAsset {
  readonly symbol: string;
  readonly exchange: string | null;
  readonly assetClass: string | null;
  readonly tradable: boolean;
  readonly status: string | null;
  readonly fractionable: boolean | null;
}

// Alpaca's /v2/assets endpoint is NOT paginated (it returns the full
// matching set in one response) -- this is Alpaca's own documented
// behavior, not an assumption this module invents. `maxAssets` is a
// client-side safety bound: if the real response exceeds it, the excess
// is truncated (deterministically, by response order) and `complete:
// false` is reported honestly -- never silently dropped without saying so.
export interface FetchTradableAssetsResult {
  readonly assets: readonly AlpacaTradableAsset[];
  readonly complete: boolean;
}

export async function fetchTradableAssets(
  config: AlpacaProviderConfig,
  maxAssets: number,
  requiredSymbols: readonly string[] = [],
): Promise<FetchTradableAssetsResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL('/v2/assets', config.tradingApiBase);
  url.search = new URLSearchParams({ status: 'active', asset_class: 'us_equity' }).toString();
  const body = await requestJson(fetchImpl, url, authHeaders(config));
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/assets did not return an array.');
  const rows = body.map((value) => providerRow(value, '/v2/assets'));
  const tradableOnly = rows.filter((raw) => raw.tradable === true);
  for (const raw of tradableOnly) {
    if (nonEmptyString(raw.symbol) === null) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/assets returned a tradable row without identity.');
    }
  }
  const complete = tradableOnly.length <= maxAssets;
  const required = new Set(requiredSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
  const bounded = tradableOnly.slice(0, maxAssets);
  const boundedSymbols = new Set(bounded.map((raw) => nonEmptyString(raw.symbol)?.toUpperCase()));
  for (const raw of tradableOnly) {
    const symbol = nonEmptyString(raw.symbol)?.toUpperCase();
    if (symbol !== undefined && required.has(symbol) && !boundedSymbols.has(symbol)) {
      bounded.push(raw);
      boundedSymbols.add(symbol);
    }
  }
  return {
    assets: bounded.map((raw) => ({
      symbol: nonEmptyString(raw.symbol) as string,
      exchange: asStringOrNull(raw.exchange),
      assetClass: asStringOrNull(raw.class),
      tradable: raw.tradable === true,
      status: asStringOrNull(raw.status),
      fractionable: asBooleanOrNull(raw.fractionable),
    })),
    complete,
  };
}

// ---------------------------------------------------------------------------
// Option contracts + chain snapshots
// ---------------------------------------------------------------------------

export interface FetchOptionContractsParams {
  readonly underlyingSymbol: string;
  readonly expirationDateGte: string;
  readonly expirationDateLte: string;
  readonly optionType: 'put' | 'call';
  readonly showDeliverables?: boolean;
  readonly limit: number; // per-page limit
  readonly maxPages: number; // safety bound -- never an unbounded pagination loop
}

// Alpaca's own documented behavior: a page-size limit applies to the total
// number of observations returned, not per-symbol/per-request, and results
// are paginated via next_page_token -- a single HTTP 200 is NEVER assumed
// to be the complete result set. `complete: false` (with the bars/items
// already fetched preserved, never discarded) is the honest signal a
// caller uses to distinguish "we saw everything" from "we stopped early."
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly complete: boolean;
  readonly pagesFetched: number;
}

export async function fetchOptionContracts(config: AlpacaProviderConfig, params: FetchOptionContractsParams): Promise<PaginatedResult<AlpacaOptionContractListing>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const items: AlpacaOptionContractListing[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;

  do {
    const url = new URL('/v2/options/contracts', config.tradingApiBase);
    const query: Record<string, string> = {
      underlying_symbols: params.underlyingSymbol, status: 'active', type: params.optionType,
      expiration_date_gte: params.expirationDateGte, expiration_date_lte: params.expirationDateLte,
      limit: String(params.limit),
    };
    if (params.showDeliverables === true) query.show_deliverables = 'true';
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    const body = await requestJson(fetchImpl, url, authHeaders(config));
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || !Array.isArray((body as Record<string, unknown>).option_contracts)) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts omitted its contract array.');
    }
    const page = body as Record<string, unknown>;
    if (page.next_page_token !== undefined && page.next_page_token !== null && typeof page.next_page_token !== 'string') {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned an invalid page token.');
    }
    for (const c of page.option_contracts as unknown[]) {
      if (c === null || typeof c !== 'object' || Array.isArray(c)) {
        throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned an invalid contract row.');
      }
      const contract = c as Record<string, unknown>;
      const symbol = asStringOrNull(contract.symbol);
      const strikePrice = asNumberOrNull(contract.strike_price);
      const expirationDate = asStringOrNull(contract.expiration_date);
      if (!symbol || strikePrice === null || strikePrice <= 0 || !expirationDate || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
        throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned an invalid contract identity.');
      }
      const deliverables = contract.deliverables;
      if (params.showDeliverables === true && deliverables !== null && deliverables !== undefined
        && !Array.isArray(deliverables)) {
        throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned malformed deliverables.');
      }
      const parsedDeliverables = Array.isArray(deliverables) ? deliverables.map((value: unknown) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned malformed deliverables.');
        }
        const row = value as Record<string, unknown>;
        const type = asStringOrNull(row.type);
        const deliverableSymbol = asStringOrNull(row.symbol);
        const amount = asNumberOrNull(row.amount);
        if (type === null || deliverableSymbol === null || amount === null || amount <= 0) {
          throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned malformed deliverables.');
        }
        return { type, symbol: deliverableSymbol, amount,
          allocationPercentage: asNumberOrNull(row.allocation_percentage) };
      }) : null;
      items.push({
        symbol,
        strikePrice,
        expirationDate,
        optionType: params.optionType === 'put' ? 'PUT' : 'CALL',
        multiplier: asNumberOrNull(contract.size),
        tradable: typeof contract.tradable === 'boolean' ? contract.tradable : null,
        rootSymbol: asStringOrNull(contract.root_symbol),
        underlyingSymbol: asStringOrNull(contract.underlying_symbol),
        exerciseStyle: asStringOrNull(contract.style),
        deliverables: parsedDeliverables,
      });
    }
    pageToken = page.next_page_token as string | null | undefined ?? null;
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { items, complete, pagesFetched: pages };
}

export interface FetchOptionSnapshotsParams {
  readonly underlyingSymbol: string;
  readonly feed: 'opra' | 'indicative';
  readonly optionType: 'put' | 'call';
  readonly expirationDateGte?: string;
  readonly expirationDateLte?: string;
  readonly strikePriceGte?: number;
  readonly strikePriceLte?: number;
  readonly limit: number; // per-page limit -- Alpaca documents default 100, max 1000
  readonly maxPages: number; // safety bound -- never an unbounded pagination loop
}

export interface PaginatedSnapshotsResult {
  readonly snapshots: ReadonlyMap<string, AlpacaOptionSnapshot>;
  readonly complete: boolean;
  readonly pagesFetched: number;
}

export async function fetchOptionSnapshots(config: AlpacaProviderConfig, params: FetchOptionSnapshotsParams): Promise<PaginatedSnapshotsResult> {
  const validDate=(value:string|undefined):boolean=>value===undefined||(/^\d{4}-\d{2}-\d{2}$/.test(value)
    &&Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    &&new Date(Date.parse(`${value}T00:00:00.000Z`)).toISOString().slice(0,10)===value);
  if(!validDate(params.expirationDateGte)||!validDate(params.expirationDateLte)
    ||(params.expirationDateGte!==undefined&&params.expirationDateLte!==undefined
      &&params.expirationDateGte>params.expirationDateLte)
    ||(params.strikePriceGte!==undefined&&(!Number.isFinite(params.strikePriceGte)||params.strikePriceGte<=0))
    ||(params.strikePriceLte!==undefined&&(!Number.isFinite(params.strikePriceLte)||params.strikePriceLte<=0))
    ||(params.strikePriceGte!==undefined&&params.strikePriceLte!==undefined
      &&params.strikePriceGte>params.strikePriceLte))throw new Error('OPTION_SNAPSHOT_FILTER_INVALID');
  const fetchImpl = config.fetchImpl ?? fetch;
  const snapshots = new Map<string, AlpacaOptionSnapshot>();
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;

  do {
    const url = new URL(`/v1beta1/options/snapshots/${params.underlyingSymbol}`, config.marketDataApiBase);
    const query: Record<string, string> = { feed: params.feed, type: params.optionType, limit: String(params.limit) };
    if(params.expirationDateGte!==undefined)query.expiration_date_gte=params.expirationDateGte;
    if(params.expirationDateLte!==undefined)query.expiration_date_lte=params.expirationDateLte;
    if(params.strikePriceGte!==undefined)query.strike_price_gte=String(params.strikePriceGte);
    if(params.strikePriceLte!==undefined)query.strike_price_lte=String(params.strikePriceLte);
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    const body = await requestJson(fetchImpl, url, authHeaders(config));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots returned an invalid page.');
    }
    const page = body as Record<string, unknown>;
    if (page.snapshots === null || typeof page.snapshots !== 'object' || Array.isArray(page.snapshots)) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots omitted its snapshot map.');
    }
    if (page.next_page_token !== undefined && page.next_page_token !== null && typeof page.next_page_token !== 'string') {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots returned an invalid page token.');
    }
    for (const [symbol, raw] of Object.entries(page.snapshots)) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots returned an invalid snapshot row.');
      }
      snapshots.set(symbol, parseOneSnapshot(raw as Record<string, unknown>));
    }
    pageToken = page.next_page_token as string | null | undefined ?? null;
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { snapshots, complete, pagesFetched: pages };
}

function parseOneSnapshot(raw: Record<string, unknown>): AlpacaOptionSnapshot {
  const quote = raw.latestQuote as Record<string, unknown> | undefined;
  const greeksRaw = raw.greeks as Record<string, unknown> | undefined;
  const dailyBar = raw.dailyBar as Record<string, unknown> | undefined;
  return {
    bid: asNumberOrNull(quote?.bp),
    ask: asNumberOrNull(quote?.ap),
    bidSize: asNumberOrNull(quote?.bs),
    askSize: asNumberOrNull(quote?.as),
    quoteTimestamp: asStringOrNull(quote?.t),
    greeks: greeksRaw !== undefined
      ? { delta: asNumberOrNull(greeksRaw.delta), gamma: asNumberOrNull(greeksRaw.gamma), theta: asNumberOrNull(greeksRaw.theta), vega: asNumberOrNull(greeksRaw.vega), rho: asNumberOrNull(greeksRaw.rho) }
      : null,
    impliedVolatility: asNumberOrNull(raw.impliedVolatility),
    dailyVolume: asNumberOrNull(dailyBar?.v),
  };
}

export interface AlpacaStockQuote {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly timestamp: string | null;
  readonly feed: 'iex' | 'sip';
}

export async function fetchLatestStockQuote(
  config: AlpacaProviderConfig,
  symbol: string,
  feed: 'iex' | 'sip',
): Promise<AlpacaStockQuote> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`, config.marketDataApiBase);
  url.search = new URLSearchParams({ feed }).toString();
  const body = providerRow(await requestJson(fetchImpl, url, authHeaders(config)), '/v2/stocks/{symbol}/quotes/latest');
  if (body.quote === undefined) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/stocks/{symbol}/quotes/latest did not return a quote.');
  }
  const quote = providerRow(body.quote, '/v2/stocks/{symbol}/quotes/latest');
  return {
    bid: asNumberOrNull(quote.bp), ask: asNumberOrNull(quote.ap),
    bidSize: asNumberOrNull(quote.bs), askSize: asNumberOrNull(quote.as),
    timestamp: asStringOrNull(quote.t), feed,
  };
}

// ---------------------------------------------------------------------------
// Historical stock bars -- real fetch wiring around underlying-history.ts's
// pure pagination/parsing logic.
// ---------------------------------------------------------------------------

export type BarAdjustment = 'raw' | 'split' | 'dividend' | 'all';

export interface FetchStockBarsParams extends FetchHistoricalBarsParams {
  readonly adjustment: BarAdjustment; // must be explicit -- see docs/quant/.../BAR_ADJUSTMENT_POLICY.md
}

export interface StockBarsResult {
  readonly bars: readonly HistoricalBar[];
  readonly complete: boolean; // false iff maxPages was hit with more pages remaining
  readonly providerZeroVwapCount: number; // optional VWAP unavailable, required OHLCV still validated
}

export async function fetchStockBars(config: AlpacaProviderConfig, params: FetchStockBarsParams, receivedAt: string): Promise<StockBarsResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const fetchPage = async (pageToken: string | null): Promise<RawAlpacaBarsPage> => {
    const url = new URL('/v2/stocks/bars', config.marketDataApiBase);
    const query: Record<string, string> = {
      symbols: params.symbols.join(','), timeframe: params.timeframe, start: params.start, end: params.end,
      adjustment: params.adjustment, feed: params.feed ?? 'iex',
    };
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    return await requestJson(fetchImpl, url, authHeaders(config)) as RawAlpacaBarsPage;
  };

  // Deliberately a local pagination loop (not underlying-history.ts's
  // fetchAllHistoricalBars, which THROWS on exceeding maxPages) -- a
  // provider-facing fetch must never discard bars it already retrieved
  // just because the safety bound was hit; it reports them with
  // complete=false instead, per Alpaca's own documented behavior that its
  // page-size limit applies to total data points (not per symbol) and a
  // multi-symbol request's first page may contain only one symbol.
  const allBars: HistoricalBar[] = [];
  let providerZeroVwapCount = 0;
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;

  do {
    const raw = await fetchPage(pageToken);
    let parsed: ReturnType<typeof parseAlpacaBarsPage>;
    try {
      parsed = parseAlpacaBarsPage(raw, params.feed, receivedAt);
    } catch (error) {
      const safeDetailCode = error instanceof Error && /^ALPACA_BARS_MALFORMED_[A-Z_]+$/.test(error.message)
        ? error.message : null;
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200,
        '/v2/stocks/bars returned invalid bar evidence.', safeDetailCode);
    }
    const { bars, nextPageToken } = parsed;
    allBars.push(...bars);
    providerZeroVwapCount += parsed.providerZeroVwapCount;
    pageToken = nextPageToken;
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { bars: allBars, complete, providerZeroVwapCount };
}
