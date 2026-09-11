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

export type AlpacaErrorClass = 'INVALID_AUTH' | 'NOT_ENTITLED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE';

export class AlpacaProviderError extends Error {
  readonly errorClass: AlpacaErrorClass;
  readonly httpStatus: number | null;
  constructor(errorClass: AlpacaErrorClass, httpStatus: number | null, message: string) {
    super(message); // message never includes header/credential content -- see call sites below
    this.name = 'AlpacaProviderError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
  }
}

const classifyErrorStatus = (status: number): AlpacaErrorClass => {
  if (status === 401 || status === 403) return status === 403 ? 'NOT_ENTITLED' : 'INVALID_AUTH';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'SERVER_ERROR';
};

async function requestJson(fetchImpl: typeof fetch, url: URL, headers: HeadersInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new AlpacaProviderError('NETWORK_ERROR', null, `Network error reaching ${url.host}${url.pathname} -- ${error instanceof Error ? error.name : 'unknown'}.`);
  }
  if (!response.ok) {
    throw new AlpacaProviderError(classifyErrorStatus(response.status), response.status, `${url.pathname} returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', response.status, `${url.pathname} returned a non-JSON body.`);
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
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const asBooleanOrNull = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export async function fetchMasterAccountSnapshot(config: AlpacaProviderConfig, receivedAt: string): Promise<MasterAccountSnapshot> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = await requestJson(fetchImpl, new URL('/v2/account', config.tradingApiBase), authHeaders(config)) as Record<string, unknown>;
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
  return body.map((raw: Record<string, unknown>) => ({
    symbol: asStringOrNull(raw.symbol) ?? '',
    assetClass: asStringOrNull(raw.asset_class),
    quantity: asNumberOrNull(raw.qty),
    side: asStringOrNull(raw.side),
    avgEntryPrice: asNumberOrNull(raw.avg_entry_price),
    marketValue: asNumberOrNull(raw.market_value),
    unrealizedPl: asNumberOrNull(raw.unrealized_pl),
    receivedAt,
  }));
}

// ---------------------------------------------------------------------------
// Open orders
// ---------------------------------------------------------------------------

export interface AlpacaOpenOrderSnapshot {
  readonly orderId: string;
  readonly clientOrderId: string | null;
  readonly symbol: string | null;
  readonly assetClass: string | null;
  readonly side: string | null;
  readonly quantity: number | null;
  readonly filledQuantity: number | null;
  readonly orderType: string | null; // Alpaca's own order_type/type, e.g. 'limit', 'market' -- passed through verbatim
  readonly limitPrice: number | null;
  readonly stopPrice: number | null;
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
  return body.map((raw: Record<string, unknown>) => ({
    orderId: asStringOrNull(raw.id) ?? '',
    clientOrderId: asStringOrNull(raw.client_order_id),
    symbol: asStringOrNull(raw.symbol),
    assetClass: asStringOrNull(raw.asset_class),
    side: asStringOrNull(raw.side),
    quantity: asNumberOrNull(raw.qty),
    filledQuantity: asNumberOrNull(raw.filled_qty),
    orderType: asStringOrNull(raw.order_type ?? raw.type),
    limitPrice: asNumberOrNull(raw.limit_price),
    stopPrice: asNumberOrNull(raw.stop_price),
    status: asStringOrNull(raw.status),
    submittedAt: asStringOrNull(raw.submitted_at),
    receivedAt,
  }));
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
  const body = await requestJson(fetchImpl, new URL('/v2/clock', config.tradingApiBase), authHeaders(config)) as Record<string, unknown>;
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
  return body.map((raw: Record<string, unknown>) => ({
    date: asStringOrNull(raw.date) ?? '',
    open: asStringOrNull(raw.open),
    close: asStringOrNull(raw.close),
    sessionOpen: asStringOrNull(raw.session_open),
    sessionClose: asStringOrNull(raw.session_close),
  }));
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

export async function fetchTradableAssets(config: AlpacaProviderConfig, maxAssets: number): Promise<FetchTradableAssetsResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL('/v2/assets', config.tradingApiBase);
  url.search = new URLSearchParams({ status: 'active', asset_class: 'us_equity' }).toString();
  const body = await requestJson(fetchImpl, url, authHeaders(config));
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/assets did not return an array.');
  const tradableOnly = body.filter((raw: Record<string, unknown>) => raw.tradable === true);
  const complete = tradableOnly.length <= maxAssets;
  return {
    assets: tradableOnly.slice(0, maxAssets).map((raw: Record<string, unknown>) => ({
      symbol: asStringOrNull(raw.symbol) ?? '',
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
// Corporate actions (event-state assembly source -- see event-state.ts).
//
// GET /v1/corporate-actions is confirmed REACHABLE (real HTTP 200 per this
// repo's own prior read-only verification, documented in
// docs/quant/phase6_router/DATA_GAP_REGISTER.md), but its exact JSON
// field-level shape was never inspected before this function was written
// -- an acknowledged, documented gap. Parsing here is DELIBERATELY
// conservative: it only trusts a `corporate_actions` object keyed by
// category (Alpaca's documented category names, e.g. cash_dividends,
// forward_splits) containing arrays of items with a symbol/date-ish
// shape. Any other top-level shape is reported `recognized: false` --
// callers must treat that as UNKNOWN, never as "confirmed no action."
// ---------------------------------------------------------------------------

export interface RawCorporateAction {
  readonly symbol: string | null;
  readonly category: string; // the raw category key, passed through verbatim -- never renamed/reinterpreted
  readonly exDate: string | null;
  readonly recordDate: string | null;
  readonly payableDate: string | null;
  readonly processDate: string | null;
}

export interface FetchCorporateActionsResult {
  readonly recognized: boolean; // false = the response did not match any shape this parser understands -- UNKNOWN, not "no actions"
  readonly actions: readonly RawCorporateAction[];
}

const KNOWN_CORPORATE_ACTION_CATEGORIES = [
  'forward_splits', 'reverse_splits', 'unit_splits', 'cash_dividends', 'stock_dividends',
  'spin_offs', 'cash_mergers', 'stock_mergers', 'stock_and_cash_mergers', 'redemptions',
  'name_changes', 'worthless_removals', 'rights_distributions',
] as const;

export async function fetchCorporateActions(
  config: AlpacaProviderConfig,
  symbols: readonly string[],
  start: string,
  end: string,
): Promise<FetchCorporateActionsResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL('/v1/corporate-actions', config.marketDataApiBase);
  url.search = new URLSearchParams({ symbols: symbols.join(','), start, end }).toString();
  const body = await requestJson(fetchImpl, url, authHeaders(config)) as Record<string, unknown>;

  const container = body.corporate_actions;
  if (container === null || container === undefined || typeof container !== 'object' || Array.isArray(container)) {
    return { recognized: false, actions: [] };
  }

  const actions: RawCorporateAction[] = [];
  for (const category of KNOWN_CORPORATE_ACTION_CATEGORIES) {
    const items = (container as Record<string, unknown>)[category];
    if (!Array.isArray(items)) continue;
    for (const raw of items as Record<string, unknown>[]) {
      actions.push({
        symbol: asStringOrNull(raw.symbol),
        category,
        exDate: asStringOrNull(raw.ex_date),
        recordDate: asStringOrNull(raw.record_date),
        payableDate: asStringOrNull(raw.payable_date),
        processDate: asStringOrNull(raw.process_date),
      });
    }
  }
  return { recognized: true, actions };
}

// ---------------------------------------------------------------------------
// Option contracts + chain snapshots
// ---------------------------------------------------------------------------

export interface FetchOptionContractsParams {
  readonly underlyingSymbol: string;
  readonly expirationDateGte: string;
  readonly expirationDateLte: string;
  readonly optionType: 'put' | 'call';
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
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    const body = await requestJson(fetchImpl, url, authHeaders(config)) as { option_contracts?: Array<Record<string, unknown>>; next_page_token?: string | null };
    for (const c of body.option_contracts ?? []) {
      items.push({
        symbol: asStringOrNull(c.symbol) ?? '',
        strikePrice: asNumberOrNull(c.strike_price) ?? 0,
        expirationDate: asStringOrNull(c.expiration_date) ?? '',
        optionType: params.optionType === 'put' ? 'PUT' : 'CALL',
      });
    }
    pageToken = body.next_page_token ?? null;
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
  readonly limit: number; // per-page limit -- Alpaca documents default 100, max 1000
  readonly maxPages: number; // safety bound -- never an unbounded pagination loop
}

export interface PaginatedSnapshotsResult {
  readonly snapshots: ReadonlyMap<string, AlpacaOptionSnapshot>;
  readonly complete: boolean;
  readonly pagesFetched: number;
}

export async function fetchOptionSnapshots(config: AlpacaProviderConfig, params: FetchOptionSnapshotsParams): Promise<PaginatedSnapshotsResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const snapshots = new Map<string, AlpacaOptionSnapshot>();
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;

  do {
    const url = new URL(`/v1beta1/options/snapshots/${params.underlyingSymbol}`, config.marketDataApiBase);
    const query: Record<string, string> = { feed: params.feed, type: params.optionType, limit: String(params.limit) };
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    const body = await requestJson(fetchImpl, url, authHeaders(config)) as { snapshots?: Record<string, Record<string, unknown>>; next_page_token?: string | null };
    for (const [symbol, raw] of Object.entries(body.snapshots ?? {})) {
      snapshots.set(symbol, parseOneSnapshot(raw));
    }
    pageToken = body.next_page_token ?? null;
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
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;

  do {
    const raw = await fetchPage(pageToken);
    const { bars, nextPageToken } = parseAlpacaBarsPage(raw, params.feed, receivedAt);
    allBars.push(...bars);
    pageToken = nextPageToken;
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { bars: allBars, complete };
}
