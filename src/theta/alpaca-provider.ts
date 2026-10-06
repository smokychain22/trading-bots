import { parseAlpacaBarsPage, type FetchHistoricalBarsParams, type HistoricalBar, type RawAlpacaBarsPage } from './underlying-history.js';
import type { AlpacaOptionContractListing, AlpacaOptionSnapshot } from './option-chain-ingestion.js';
import { providerNetworkFailureCode } from './provider-network-failure.js';
import { parseRetryAfterMs, runBoundedRead, type ReadRetryOptions } from '../execution/broker.js';

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
  /** Injectable for deterministic boundary tests. Production defaults to 15 seconds. */
  readonly requestTimeoutMs?: number;
  /** Injectable bounded read-retry policy / sleep / jitter / shared budget (tests use fakes; production uses defaults). */
  readonly readRetry?: ReadRetryOptions;
}

const authHeaders = (config: AlpacaProviderConfig): HeadersInit => ({
  'APCA-API-KEY-ID': config.apiKey,
  'APCA-API-SECRET-KEY': config.apiSecret,
});

function assertPaginationBounds(maxPages: number, limit?: number): void {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1
    || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)))
    throw new AlpacaProviderError('INVALID_REQUEST', null, 'ALPACA_PAGINATION_BOUND_INVALID');
}

export type AlpacaErrorClass = 'INVALID_REQUEST' | 'INVALID_AUTH' | 'NOT_ENTITLED' | 'RATE_LIMITED' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'PROVIDER_TIMEOUT' | 'MALFORMED_RESPONSE';

export class AlpacaProviderError extends Error {
  readonly errorClass: AlpacaErrorClass;
  readonly httpStatus: number | null;
  readonly safeDetailCode: string | null;
  /** Parsed Retry-After hint (ms) from a 429, or null. Used only by the bounded read-retry policy. */
  readonly retryAfterMs: number | null;
  constructor(errorClass: AlpacaErrorClass, httpStatus: number | null, message: string, safeDetailCode: string | null = null, retryAfterMs: number | null = null) {
    super(message); // message never includes header/credential content -- see call sites below
    this.name = 'AlpacaProviderError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
    this.safeDetailCode = safeDetailCode;
    this.retryAfterMs = retryAfterMs;
  }
}

const classifyErrorStatus = (status: number): AlpacaErrorClass => {
  if (status === 401 || status === 403) return status === 403 ? 'NOT_ENTITLED' : 'INVALID_AUTH';
  if (status === 429) return 'RATE_LIMITED';
  // 408 Request Timeout is a transient server-side timeout, not a caller error that retrying cannot fix.
  if (status === 408) return 'PROVIDER_TIMEOUT';
  if (status >= 500) return 'SERVER_ERROR';
  return 'INVALID_REQUEST';
};

/**
 * All provider calls here are READS. A 429 is retried with the shared bounded policy (exponential backoff + jitter, honors
 * Retry-After, hard caps on attempts and total wait, process-wide budget/cooldown) and then surfaces as RATE_LIMITED.
 * Other failure classes are not retried here; the caller's own cycle decides.
 */
async function requestJson(fetchImpl: typeof fetch, url: URL, headers: HeadersInit, requestTimeoutMs = 15_000, retry: ReadRetryOptions = {}): Promise<unknown> {
  return runBoundedRead(() => requestJsonOnce(fetchImpl, url, headers, requestTimeoutMs, retry.now ?? Date.now), (error) => {
    const limited = error instanceof AlpacaProviderError && error.errorClass === 'RATE_LIMITED';
    return { retryable: limited, rateLimited: limited, retryAfterMs: limited ? (error as AlpacaProviderError).retryAfterMs : null };
  }, () => new AlpacaProviderError('RATE_LIMITED', 429, `${url.pathname} refused locally: shared rate-limit cooldown exceeds the bounded wait.`), retry);
}

async function requestJsonOnce(fetchImpl: typeof fetch, url: URL, headers: HeadersInit, requestTimeoutMs: number, nowFn: () => number): Promise<unknown> {
  // Read-only market/broker calls must finish inside the bounded serverless
  // evidence cycle. A stalled read is provider uncertainty, never empty data.
  const controller = new AbortController();
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new AlpacaProviderError('INVALID_REQUEST', null, 'Alpaca request timeout policy is invalid.');
  }
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers?.get?.('retry-after'), nowFn()) : null;
      throw new AlpacaProviderError(classifyErrorStatus(response.status), response.status, `${url.pathname} returned HTTP ${response.status}.`, null, retryAfterMs);
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new AlpacaProviderError('PROVIDER_TIMEOUT', null, `${url.pathname} read timed out.`);
      const detail = providerNetworkFailureCode(error);
      if (detail !== 'PROVIDER_NETWORK_UNKNOWN') throw new AlpacaProviderError('NETWORK_ERROR', response.status, detail, detail);
      throw new AlpacaProviderError('MALFORMED_RESPONSE', response.status, `${url.pathname} returned a non-JSON body.`);
    }
  } catch (error) {
    if (error instanceof AlpacaProviderError) throw error;
    if (controller.signal.aborted) throw new AlpacaProviderError('PROVIDER_TIMEOUT', null, `${url.pathname} read timed out.`);
    const detail = providerNetworkFailureCode(error);
    throw new AlpacaProviderError('NETWORK_ERROR', null, detail, detail);
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
const validDateOnly = (value: string | null | undefined): value is string => {
  if (value === null || value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};
const providerRow = (value: unknown, operation: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', null, `${operation} returned a malformed row.`);
  }
  return value as Record<string, unknown>;
};
const optionalProviderRow = (value: unknown, operation: string): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  return providerRow(value, operation);
};

export async function fetchMasterAccountSnapshot(config: AlpacaProviderConfig, receivedAt: string): Promise<MasterAccountSnapshot> {
  return normalizeMasterAccount(await fetchAccountBody(config),receivedAt);
}

async function fetchAccountBody(config: AlpacaProviderConfig):Promise<Record<string,unknown>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  return providerRow(await requestJson(fetchImpl, new URL('/v2/account', config.tradingApiBase), authHeaders(config), config.requestTimeoutMs, config.readRetry), '/v2/account');
}

/** Server-side persistence context only. Raw identity stays out of the public
 * snapshot. Uses the same bounded GET/parser as the ordinary account read. */
export async function fetchMasterAccountEvidence(config:AlpacaProviderConfig,
  clock:()=>string=()=>new Date().toISOString()):Promise<{
    readonly providerAccountId:string;readonly requestedAt:string;readonly snapshot:MasterAccountSnapshot;
  }> {
  const requestedAt=clock();
  const body=await fetchAccountBody(config);
  const receivedAt=clock();
  if(!Number.isFinite(Date.parse(requestedAt))||!Number.isFinite(Date.parse(receivedAt))
    ||Date.parse(receivedAt)<Date.parse(requestedAt))throw new Error('ALPACA_ACCOUNT_RECEIPT_TIME_INVALID');
  const providerAccountId=nonEmptyString(body.id);
  if(providerAccountId===null)throw new AlpacaProviderError('MALFORMED_RESPONSE',null,'MASTER_ACCOUNT_IDENTITY_UNKNOWN');
  return {providerAccountId,requestedAt,snapshot:normalizeMasterAccount(body,receivedAt)};
}

function normalizeMasterAccount(body:Record<string,unknown>,receivedAt:string):MasterAccountSnapshot {
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
  const body = await requestJson(fetchImpl, new URL('/v2/positions', config.tradingApiBase), authHeaders(config), config.requestTimeoutMs, config.readRetry);
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
  /** Broker-reported cumulative filled quantity. Production reads always set
   * this field, including zero. Optional only for archived/manual callers. */
  readonly filledQuantity?: number | null;
  readonly limitPrice: number | null;
  readonly status: string | null;
  readonly submittedAt: string | null;
  readonly receivedAt: string;
}

export async function fetchOpenOrders(config: AlpacaProviderConfig, receivedAt: string,
  options: { readonly maxPages?: number } = {}): Promise<readonly AlpacaOpenOrderSnapshot[]> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? 100;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_PAGE_BOUND_INVALID');
  const orders = new Map<string, AlpacaOpenOrderSnapshot>();
  const cursors = new Set<string>();
  let beforeOrderId: string | null = null;
  for (let page = 0; page < maxPages; page++) {
  const url = new URL('/v2/orders', config.tradingApiBase);
  // Order-ID pagination avoids skipping orders with the same submitted_at.
  // Explicit flat results retain individual legs. A partial page set never
  // becomes proof that the account has no other pending orders.
  url.search = new URLSearchParams({ status: 'open', limit: '500', direction: 'desc', nested: 'false' }).toString();
  if (beforeOrderId !== null) url.searchParams.set('before_order_id', beforeOrderId);
  const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/orders did not return an array.');
  if (body.length > 500) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_PAGE_LIMIT_EXCEEDED');
  const normalized = body.map((value): AlpacaOpenOrderSnapshot => {
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
      filledQuantity: asNumberOrNull(raw.filled_qty),
      limitPrice: asNumberOrNull(raw.limit_price),
      status: nonEmptyString(raw.status),
      submittedAt: nonEmptyString(raw.submitted_at),
      receivedAt,
    };
  });
  for (const order of normalized) {
    const prior = orders.get(order.orderId);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(order))
      throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_DUPLICATE_CONFLICT');
    orders.set(order.orderId, order);
  }
  if (body.length < 500) return [...orders.values()];
  const cursor = normalized.at(-1)?.orderId;
  if (cursor === undefined) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_CURSOR_MISSING');
  if (cursors.has(cursor)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_CURSOR_REPEATED');
  cursors.add(cursor);
  beforeOrderId = cursor;
  }
  throw new AlpacaProviderError('MALFORMED_RESPONSE', null, 'ALPACA_OPEN_ORDERS_PAGINATION_INCOMPLETE');
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
  const body = providerRow(await requestJson(fetchImpl, new URL('/v2/clock', config.tradingApiBase), authHeaders(config), config.requestTimeoutMs, config.readRetry), '/v2/clock');
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
  const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
  if (!Array.isArray(body)) throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/calendar did not return an array.');
  return body.map((value) => {
    const raw = providerRow(value, '/v2/calendar');
    const date = nonEmptyString(raw.date);
    if (!validDateOnly(date)) {
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
  const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
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

function normalizeOptionContract(
  value: unknown,
  optionType: 'put' | 'call',
  endpoint: string,
  requireDeliverableShape: boolean,
): AlpacaOptionContractListing {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned an invalid contract row.`);
  }
  const contract = value as Record<string, unknown>;
  const symbol = asStringOrNull(contract.symbol);
  const strikePrice = asNumberOrNull(contract.strike_price);
  const expirationDate = asStringOrNull(contract.expiration_date);
  if (!symbol || strikePrice === null || strikePrice <= 0 || !validDateOnly(expirationDate)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned an invalid contract identity.`);
  }
  const deliverables = contract.deliverables;
  if (requireDeliverableShape && deliverables !== null && deliverables !== undefined && !Array.isArray(deliverables)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned malformed deliverables.`);
  }
  const parsedDeliverables = Array.isArray(deliverables) ? deliverables.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned malformed deliverables.`);
    }
    const row = item as Record<string, unknown>;
    const type = asStringOrNull(row.type);
    const deliverableSymbol = asStringOrNull(row.symbol);
    const amount = asNumberOrNull(row.amount);
    if (type === null || deliverableSymbol === null || amount === null || amount <= 0) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned malformed deliverables.`);
    }
    return { type, symbol: deliverableSymbol, amount,
      allocationPercentage: asNumberOrNull(row.allocation_percentage) };
  }) : null;
  return {
    symbol,
    strikePrice,
    expirationDate,
    optionType: optionType === 'put' ? 'PUT' : 'CALL',
    multiplier: asNumberOrNull(contract.size),
    tradable: typeof contract.tradable === 'boolean' ? contract.tradable : null,
    rootSymbol: asStringOrNull(contract.root_symbol),
    underlyingSymbol: asStringOrNull(contract.underlying_symbol),
    exerciseStyle: asStringOrNull(contract.style),
    deliverables: parsedDeliverables,
  };
}

/** Exact broker contract identity lookup used for restart reconstruction. */
export async function fetchOptionContract(
  config: AlpacaProviderConfig,
  symbolOrId: string,
): Promise<AlpacaOptionContractListing> {
  const identity = symbolOrId.trim();
  if (identity.length === 0) throw new AlpacaProviderError('INVALID_REQUEST', null, 'ALPACA_OPTION_CONTRACT_IDENTITY_REQUIRED');
  const fetchImpl = config.fetchImpl ?? fetch;
  const endpoint = '/v2/options/contracts/{symbol_or_id}';
  const url = new URL(`/v2/options/contracts/${encodeURIComponent(identity)}`, config.tradingApiBase);
  const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned an invalid contract.`);
  }
  const rawType = asStringOrNull((body as Record<string, unknown>).type)?.toLowerCase();
  if (rawType !== 'put' && rawType !== 'call') {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned an invalid option type.`);
  }
  const normalized = normalizeOptionContract(body, rawType, endpoint, true);
  if (normalized.symbol !== identity) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, `${endpoint} returned a mismatched contract identity.`);
  }
  return normalized;
}

export async function fetchOptionContracts(config: AlpacaProviderConfig, params: FetchOptionContractsParams): Promise<PaginatedResult<AlpacaOptionContractListing>> {
  assertPaginationBounds(params.maxPages, params.limit);
  const fetchImpl = config.fetchImpl ?? fetch;
  const items: AlpacaOptionContractListing[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  let complete = true;
  const seenTokens = new Set<string>();
  const seenContracts = new Map<string,string>();

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
    const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || !Array.isArray((body as Record<string, unknown>).option_contracts)) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts omitted its contract array.');
    }
    const page = body as Record<string, unknown>;
    if (page.next_page_token !== undefined && page.next_page_token !== null && typeof page.next_page_token !== 'string') {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts returned an invalid page token.');
    }
    const nextToken = page.next_page_token;
    if (typeof nextToken === 'string' && (nextToken.length === 0 || seenTokens.has(nextToken))) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v2/options/contracts repeated or emptied its page token.');
    }
    for (const c of page.option_contracts as unknown[]) {
      const normalized = normalizeOptionContract(c, params.optionType, '/v2/options/contracts', params.showDeliverables === true);
      const symbol = normalized.symbol;
      const signature=JSON.stringify(normalized);
      const previous=seenContracts.get(symbol);
      if(previous!==undefined&&previous!==signature)throw new AlpacaProviderError('MALFORMED_RESPONSE',200,
        '/v2/options/contracts returned conflicting contract observations.','ALPACA_CONTRACT_DUPLICATE_CONFLICT');
      if(previous===undefined){seenContracts.set(symbol,signature);items.push(normalized);}
    }
    pageToken = page.next_page_token as string | null | undefined ?? null;
    if (pageToken !== null) seenTokens.add(pageToken);
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
  assertPaginationBounds(params.maxPages, params.limit);
  if(!(params.expirationDateGte === undefined || validDateOnly(params.expirationDateGte))
    || !(params.expirationDateLte === undefined || validDateOnly(params.expirationDateLte))
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
  const seenTokens = new Set<string>();

  do {
    const url = new URL(`/v1beta1/options/snapshots/${params.underlyingSymbol}`, config.marketDataApiBase);
    const query: Record<string, string> = { feed: params.feed, type: params.optionType, limit: String(params.limit) };
    if(params.expirationDateGte!==undefined)query.expiration_date_gte=params.expirationDateGte;
    if(params.expirationDateLte!==undefined)query.expiration_date_lte=params.expirationDateLte;
    if(params.strikePriceGte!==undefined)query.strike_price_gte=String(params.strikePriceGte);
    if(params.strikePriceLte!==undefined)query.strike_price_lte=String(params.strikePriceLte);
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    const body = await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry);
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
    const nextToken = page.next_page_token;
    if (typeof nextToken === 'string' && (nextToken.length === 0 || seenTokens.has(nextToken))) {
      throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots repeated or emptied its page token.');
    }
    for (const [symbol, raw] of Object.entries(page.snapshots)) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new AlpacaProviderError('MALFORMED_RESPONSE', 200, '/v1beta1/options/snapshots returned an invalid snapshot row.');
      }
      const parsed=parseOneSnapshot(raw as Record<string,unknown>);
      const previous=snapshots.get(symbol);
      if(previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(parsed)){
        throw new AlpacaProviderError('MALFORMED_RESPONSE',200,
          '/v1beta1/options/snapshots returned conflicting contract observations.','ALPACA_SNAPSHOT_DUPLICATE_CONFLICT');
      }
      if(previous===undefined)snapshots.set(symbol,parsed);
    }
    pageToken = page.next_page_token as string | null | undefined ?? null;
    if (pageToken !== null) seenTokens.add(pageToken);
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { snapshots, complete, pagesFetched: pages };
}

function parseOneSnapshot(raw: Record<string, unknown>): AlpacaOptionSnapshot {
  const quote = optionalProviderRow(raw.latestQuote, '/v1beta1/options/snapshots.latestQuote');
  const greeksRaw = optionalProviderRow(raw.greeks, '/v1beta1/options/snapshots.greeks');
  const dailyBar = optionalProviderRow(raw.dailyBar, '/v1beta1/options/snapshots.dailyBar');
  return {
    bid: asNumberOrNull(quote?.bp),
    ask: asNumberOrNull(quote?.ap),
    bidSize: asNumberOrNull(quote?.bs),
    askSize: asNumberOrNull(quote?.as),
    quoteTimestamp: asStringOrNull(quote?.t),
    greeks: greeksRaw !== null
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

export interface AlpacaStockTrade {
  readonly price: number | null;
  readonly size: number | null;
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
  const body = providerRow(await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry), '/v2/stocks/{symbol}/quotes/latest');
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

/** Current stock reference for research moneyness only. A trade price never
 * substitutes for an option BBO and never authorizes an order. */
export async function fetchLatestStockTrade(
  config: AlpacaProviderConfig,
  symbol: string,
  feed: 'iex' | 'sip',
): Promise<AlpacaStockTrade> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL(`/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`, config.marketDataApiBase);
  url.search = new URLSearchParams({ feed }).toString();
  const body = providerRow(await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry), '/v2/stocks/{symbol}/trades/latest');
  if (body.trade === undefined) {
    throw new AlpacaProviderError('MALFORMED_RESPONSE', null, '/v2/stocks/{symbol}/trades/latest did not return a trade.');
  }
  const trade = providerRow(body.trade, '/v2/stocks/{symbol}/trades/latest');
  return { price: asNumberOrNull(trade.p), size: asNumberOrNull(trade.s),
    timestamp: asStringOrNull(trade.t), feed };
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

export interface StockSnapshotLiquidity {
  readonly price: number;
  readonly dollarVolume: number;
}

/**
 * One multi-symbol Alpaca snapshot sweep used only to RANK a large asset list before bounding it. A symbol with no
 * usable daily bar is simply absent from the result (UNKNOWN), never ranked as zero. This is a research-ranking
 * signal and grants no execution authority.
 */
export async function fetchStockSnapshotLiquidity(
  config: AlpacaProviderConfig,
  symbols: readonly string[],
  options: { readonly batchSize: number; readonly concurrency: number; readonly feed?: 'iex' | 'sip' },
): Promise<{ readonly liquidity: ReadonlyMap<string, StockSnapshotLiquidity>; readonly failedBatches: number; readonly totalBatches: number }> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || !Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new AlpacaProviderError('INVALID_REQUEST', null, 'Snapshot ranking batch bounds must be positive integers.');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += options.batchSize) batches.push(symbols.slice(i, i + options.batchSize) as string[]);
  const liquidity = new Map<string, StockSnapshotLiquidity>();
  let failedBatches = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next++] as string[];
      try {
        const url = new URL('/v2/stocks/snapshots', config.marketDataApiBase);
        url.search = new URLSearchParams({ symbols: batch.join(','), feed: options.feed ?? 'iex' }).toString();
        const body = providerRow(await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry), '/v2/stocks/snapshots');
        for (const [symbol, raw] of Object.entries(body)) {
          if (raw === null || typeof raw !== 'object') continue;
          const row = raw as Record<string, unknown>;
          // The previous completed session is a stable full-day measure; the current bar is partial intraday.
          const bar = (row.prevDailyBar ?? row.dailyBar) as Record<string, unknown> | undefined;
          if (bar === undefined || bar === null || typeof bar !== 'object') continue;
          const close = asNumberOrNull(bar.c), volume = asNumberOrNull(bar.v);
          if (close === null || volume === null || close <= 0 || volume < 0) continue;
          liquidity.set(symbol.toUpperCase(), { price: close, dollarVolume: close * volume });
        }
      } catch {
        failedBatches += 1; // symbols of a failed batch stay UNKNOWN; the caller decides how to degrade
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(1, batches.length)) }, () => worker()));
  return { liquidity, failedBatches, totalBatches: batches.length };
}

export async function fetchStockBars(config: AlpacaProviderConfig, params: FetchStockBarsParams, receivedAt: string): Promise<StockBarsResult> {
  assertPaginationBounds(params.maxPages);
  const fetchImpl = config.fetchImpl ?? fetch;
  const fetchPage = async (pageToken: string | null): Promise<RawAlpacaBarsPage> => {
    const url = new URL('/v2/stocks/bars', config.marketDataApiBase);
    const query: Record<string, string> = {
      symbols: params.symbols.join(','), timeframe: params.timeframe, start: params.start, end: params.end,
      adjustment: params.adjustment, feed: params.feed ?? 'iex',
    };
    if (pageToken !== null) query.page_token = pageToken;
    url.search = new URLSearchParams(query).toString();
    return await requestJson(fetchImpl, url, authHeaders(config), config.requestTimeoutMs, config.readRetry) as RawAlpacaBarsPage;
  };

  // Deliberately a local pagination loop (not underlying-history.ts's
  // fetchAllHistoricalBars, which THROWS on exceeding maxPages) -- a
  // provider-facing fetch must never discard bars it already retrieved
  // just because the safety bound was hit; it reports them with
  // complete=false instead, per Alpaca's own documented behavior that its
  // page-size limit applies to total data points (not per symbol) and a
  // multi-symbol request's first page may contain only one symbol.
  const allBars: HistoricalBar[] = [];
  const seenBars=new Map<string,string>();
  const seenBarTokens=new Set<string>();
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
    for(const bar of bars){
      const identity=`${bar.symbol}:${Date.parse(bar.timestamp)}`;
      const signature=JSON.stringify({...bar,timestamp:Date.parse(bar.timestamp)});
      const previous=seenBars.get(identity);
      if(previous!==undefined&&previous!==signature)throw new AlpacaProviderError('MALFORMED_RESPONSE',200,
        '/v2/stocks/bars returned conflicting observations.','ALPACA_BAR_DUPLICATE_CONFLICT');
      if(previous===undefined){seenBars.set(identity,signature);allBars.push(bar);
        if(bar.vwapSourceState==='PROVIDER_ZERO_UNAVAILABLE')providerZeroVwapCount++;}
    }
    pageToken = nextPageToken;
    if(pageToken!==null){
      if(pageToken.length===0||seenBarTokens.has(pageToken))throw new AlpacaProviderError('MALFORMED_RESPONSE',200,
        '/v2/stocks/bars repeated or emptied its page token.','ALPACA_BAR_PAGINATION_INVALID');
      seenBarTokens.add(pageToken);
    }
    pages += 1;
    if (pages >= params.maxPages && pageToken !== null) {
      complete = false;
      break;
    }
  } while (pageToken !== null);

  return { bars: allBars, complete, providerZeroVwapCount };
}
