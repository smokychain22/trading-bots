import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertBrokerMutationAuthorized, type BrokerMutationAuthorization } from './execution-control.js';

export type BrokerAccountKind = 'MASTER_API_KEY' | 'FOLLOWER_API_KEY' | 'FOLLOWER_OAUTH';

export type AlpacaPaperAuthentication =
  | { readonly kind: 'MASTER_API_KEY'; readonly apiKey: string; readonly apiSecret: string }
  | { readonly kind: 'FOLLOWER_API_KEY'; readonly apiKey: string; readonly apiSecret: string }
  | { readonly kind: 'FOLLOWER_OAUTH'; readonly accessToken: string };

export interface BrokerOrderRequest {
  /** Internal economic identity. For an mleg parent this is a deterministic
   * package identity and is deliberately not sent as Alpaca's `symbol`. */
  readonly symbol: string;
  readonly qty: number;
  readonly side: 'buy' | 'sell';
  readonly type: 'limit';
  readonly time_in_force: 'day';
  readonly limit_price: string;
  readonly client_order_id: string;
  readonly position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
  readonly order_class?: 'mleg';
  readonly legs?: readonly BrokerOrderLegRequest[];
}

export interface BrokerOrderLegRequest {
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly ratio_qty: number;
  readonly position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
}

export interface BrokerOrderLegSnapshot {
  readonly id: string;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly positionIntent: BrokerOrderLegRequest['position_intent'] | null;
  readonly ratioQty: number;
  readonly qty: number;
  readonly filledQty: number;
  readonly filledAvgPrice: number | null;
  readonly status: string;
}

export interface BrokerOrderSnapshot {
  readonly id: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly qty: number;
  readonly filledQty: number;
  readonly filledAvgPrice: number | null;
  readonly side: 'buy' | 'sell';
  readonly positionIntent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close' | null;
  readonly status: string;
  readonly limitPrice: number | null;
  readonly submittedAt: string | null;
  readonly replacedBy: string | null;
  readonly replaces: string | null;
  readonly orderClass?: 'mleg' | null;
  readonly legs?: readonly BrokerOrderLegSnapshot[];
}

export interface BrokerActivity {
  readonly netAmount?: number | null;
  readonly perShareAmount?: number | null;
  readonly id: string;
  readonly activityType: string;
  readonly symbol: string | null;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly date: string | null;
  readonly orderId: string | null;
}

export interface BrokerMarketClock {
  readonly timestamp: string | null;
  readonly isOpen: boolean | null;
  readonly nextOpen: string | null;
  readonly nextClose: string | null;
}

export interface BrokerCalendarSession {
  readonly date: string;
  readonly open: string | null;
  readonly close: string | null;
}

export interface PaperBrokerAdapter {
  readonly accountKind: BrokerAccountKind;
  readonly environment: 'PAPER';
  getAccount(): Promise<unknown>;
  getPositions(): Promise<readonly unknown[]>;
  getOrders(status?: 'open' | 'closed' | 'all'): Promise<readonly BrokerOrderSnapshot[]>;
  getOrder(providerOrderId: string): Promise<BrokerOrderSnapshot | null>;
  getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null>;
  getActivities(activityTypes?: readonly string[]): Promise<readonly BrokerActivity[]>;
  getClock?(): Promise<BrokerMarketClock>;
  getCalendar?(start: string, end: string): Promise<readonly BrokerCalendarSession[]>;
  submitOrder(order: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot>;
  replaceOrder(providerOrderId: string, replacement: Pick<BrokerOrderRequest, 'qty' | 'limit_price' | 'time_in_force' | 'client_order_id'>, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot>;
  cancelOrder(providerOrderId: string, authorization: BrokerMutationAuthorization): Promise<void>;
}

const strictNumericProviderField = z.union([
  z.number().finite(),
  z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
]);
const validDateOnly = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};
const validProviderInstant = (value: string): boolean => /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value));
const validMarketTime = (value: string): boolean => {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (match === null) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
};
const providerInstantSchema = z.string().refine(validProviderInstant);
const providerDateOrInstantSchema = z.string().refine((value) => validDateOnly(value) || validProviderInstant(value));
const providerDateSchema = z.string().refine(validDateOnly);
const marketTimeSchema = z.string().refine(validMarketTime);
const providerIdentitySchema = z.string().refine((value) => value.trim().length > 0);

const rawOrderLegSchema = z.object({
  id: providerIdentitySchema,
  symbol: providerIdentitySchema,
  side: z.enum(['buy', 'sell']),
  position_intent: z.enum(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']).nullable().optional(),
  ratio_qty: strictNumericProviderField.optional(),
  qty: strictNumericProviderField,
  filled_qty: strictNumericProviderField,
  filled_avg_price: strictNumericProviderField.nullable().optional(),
  status: providerIdentitySchema,
}).passthrough();

const rawOrderSchema = z.object({
  id: providerIdentitySchema,
  client_order_id: providerIdentitySchema,
  // An mleg parent's top-level symbol/side may be empty or null (the package lives in its legs). A single-leg order still requires both:
  // the check below rejects an empty or missing value for it. A strict schema here would crash reconciliation on the first native spread,
  // the same failure class as Release A's historical simple orders.
  symbol: z.union([providerIdentitySchema, z.literal('')]).nullable().optional(),
  qty: strictNumericProviderField,
  filled_qty: strictNumericProviderField,
  filled_avg_price: strictNumericProviderField.nullable().optional(),
  side: z.enum(['buy', 'sell', '']).nullable().optional(),
  position_intent: z.enum(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']).nullable().optional(),
  status: providerIdentitySchema,
  limit_price: strictNumericProviderField.nullable().optional(),
  submitted_at: providerInstantSchema.nullable().optional(),
  replaced_by: providerIdentitySchema.nullable().optional(),
  replaces: providerIdentitySchema.nullable().optional(),
  // Alpaca represents a plain single-leg order as order_class "" (or "simple") with legs null; only mleg carries a package. Any other class
  // (bracket / oco / oto) is not a THETA order shape and still fails closed.
  order_class: z.enum(['', 'simple', 'mleg']).nullable().optional(),
  legs: z.array(rawOrderLegSchema).nullable().optional(),
}).passthrough();

const finiteNumber = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Alpaca returned a non-finite numeric field.');
  return parsed;
};

const nullableNumber = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : finiteNumber(value);

/**
 * A genuine HTTP 404 ("this order does not exist") is the ONLY response that may be read as "absent". A 200 with a literal `null` body (a proxy or
 * gateway glitch) is NOT absence: reconciliation treats absence as "the order never reached the broker", so a false absence could lead to a
 * duplicate economic order. The sentinel keeps the two apart.
 */
const ORDER_NOT_FOUND = Symbol('ALPACA_ORDER_NOT_FOUND');

/**
 * Sanitized description of a provider payload that failed the parser: schema paths and issue codes, or the parser's own constant message.
 * Never a provider value (no ids, symbols, prices or account data), so it is safe in persisted cycle evidence. Release A failed every cycle
 * with only ALPACA_ORDERS_MALFORMED_RESPONSE_HTTP_200 and needed a live probe to find the shape; this makes the shape visible directly.
 */
export function describeProviderShapeFailure(error: unknown): string {
  const prefix = error instanceof ProviderRowError ? `row[${error.rowIndex}] ` : '';
  const cause = error instanceof ProviderRowError ? error.cause : error;
  if (cause instanceof z.ZodError) {
    return prefix + cause.issues.slice(0, 5).map((issue) => `${issue.path.map(String).join('.') || '(root)'}:${issue.code}`).join(',');
  }
  const message = cause instanceof Error ? cause.message : 'UNKNOWN_PARSE_FAILURE';
  return prefix + (/^Alpaca returned [a-z -]+\.$/i.test(message) ? message : 'PARSER_ERROR');
}

class ProviderRowError extends Error {
  constructor(readonly rowIndex: number, override readonly cause: unknown) { super(`PROVIDER_ROW_${rowIndex}_INVALID`); }
}
const TERMINAL_PROVIDER_ORDER_STATUSES = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced', 'done_for_day']);
const terminalClassRowSchema = z.object({ order_class: z.enum(['bracket', 'oco', 'oto']), status: z.string(),
  legs: z.array(z.object({ status: z.string() }).passthrough()).nullable().optional() }).passthrough();

/**
 * A bracket/OCO/OTO order is never a THETA order (THETA sends only simple and mleg). A fully terminal one in the account history (parent AND every
 * nested child terminal) can carry no working exposure, and a filled one's position is reconciled from the positions endpoint, so it must not
 * fail the whole order listing the way Release A's historical simple orders did. A non-terminal one (including a filled bracket parent with a
 * working take-profit/stop child) is live unknown exposure and still fails closed.
 */
export function isTerminalNonThetaClassOrder(raw: unknown): boolean {
  const row = terminalClassRowSchema.safeParse(raw);
  return row.success && TERMINAL_PROVIDER_ORDER_STATUSES.has(row.data.status.toLowerCase())
    && (row.data.legs ?? []).every((leg) => TERMINAL_PROVIDER_ORDER_STATUSES.has(leg.status.toLowerCase()));
}

const parseBrokerOrderRow = (raw: unknown, rowIndex: number): BrokerOrderSnapshot => {
  try { return parseBrokerOrder(raw); } catch (error) { throw new ProviderRowError(rowIndex, error); }
};

export const parseBrokerOrder = (raw: unknown): BrokerOrderSnapshot => {
  const order = rawOrderSchema.parse(raw);
  const qty = finiteNumber(order.qty);
  const filledQty = finiteNumber(order.filled_qty);
  const filledAvgPrice = nullableNumber(order.filled_avg_price);
  const limitPrice = nullableNumber(order.limit_price);
  const isMultiLeg = order.order_class === 'mleg';
  if (qty <= 0) throw new Error('Alpaca returned an invalid order quantity.');
  if (filledQty < 0 || filledQty > qty) throw new Error('Alpaca returned an invalid filled order quantity.');
  if (filledAvgPrice !== null && (isMultiLeg ? filledAvgPrice === 0 : filledAvgPrice <= 0)) {
    throw new Error('Alpaca returned an invalid filled average price.');
  }
  // Alpaca mleg price convention: positive is a debit, negative is a credit.
  // Single-leg option and stock limits remain strictly positive.
  if (limitPrice !== null && (isMultiLeg ? limitPrice === 0 : limitPrice <= 0)) {
    throw new Error('Alpaca returned an invalid limit price.');
  }
  const legs: BrokerOrderLegSnapshot[] | undefined = (order.legs ?? undefined)?.map((leg) => {
    const legQty = finiteNumber(leg.qty);
    const legFilledQty = finiteNumber(leg.filled_qty);
    const ratioQty = finiteNumber(leg.ratio_qty ?? 1);
    const legFilledAvgPrice = nullableNumber(leg.filled_avg_price);
    if (!Number.isSafeInteger(ratioQty) || ratioQty <= 0 || legQty <= 0 || legFilledQty < 0 || legFilledQty > legQty) {
      throw new Error('Alpaca returned invalid multi-leg order quantities.');
    }
    if (legFilledAvgPrice !== null && legFilledAvgPrice <= 0) {
      throw new Error('Alpaca returned an invalid multi-leg average fill price.');
    }
    return { id: leg.id, symbol: leg.symbol, side: leg.side, positionIntent: leg.position_intent ?? null,
      ratioQty, qty: legQty, filledQty: legFilledQty, filledAvgPrice: legFilledAvgPrice, status: leg.status };
  });
  if (isMultiLeg && (legs === undefined || legs.length < 2 || legs.length > 4)) {
    throw new Error('Alpaca returned an invalid multi-leg parent order.');
  }
  const singleLegSymbol = order.symbol === null || order.symbol === undefined || order.symbol === '' ? undefined : order.symbol;
  const singleLegSide = order.side === 'buy' || order.side === 'sell' ? order.side : undefined;
  if (!isMultiLeg && (singleLegSymbol === undefined || singleLegSide === undefined)) {
    throw new Error('Alpaca returned a single-leg order without symbol or side.');
  }
  const symbol = isMultiLeg ? multiLegPackageIdentity(legs as readonly Pick<BrokerOrderLegSnapshot, 'symbol' | 'side' | 'ratioQty' | 'positionIntent'>[])
    : singleLegSymbol as string;
  const side = isMultiLeg ? ((legs as readonly BrokerOrderLegSnapshot[])[0]?.side ?? 'sell') : singleLegSide as 'buy' | 'sell';
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol,
    qty,
    filledQty,
    filledAvgPrice,
    side,
    positionIntent: order.position_intent ?? null,
    status: order.status,
    limitPrice,
    submittedAt: order.submitted_at ?? null,
    replacedBy: order.replaced_by ?? null,
    replaces: order.replaces ?? null,
    orderClass: isMultiLeg ? 'mleg' : null,
    ...(legs === undefined ? {} : { legs }),
  };
};

export const multiLegPackageIdentity = (legs: readonly Pick<BrokerOrderLegRequest, 'symbol' | 'side' | 'ratio_qty' | 'position_intent'>[]
  | readonly Pick<BrokerOrderLegSnapshot, 'symbol' | 'side' | 'ratioQty' | 'positionIntent'>[]): string => {
  if (legs.length < 2 || legs.length > 4) throw new Error('MULTI_LEG_COUNT_INVALID');
  const encoded = legs.map((leg) => {
    const ratio = 'ratio_qty' in leg ? leg.ratio_qty : leg.ratioQty;
    const intent = 'position_intent' in leg ? leg.position_intent : leg.positionIntent;
    return `${leg.symbol}:${leg.side}:${ratio}:${intent ?? 'UNKNOWN'}`;
  }).join('|');
  return `MLEG:${encoded}`;
};

export const brokerPayloadForOrder = (order: BrokerOrderRequest): Readonly<Record<string, unknown>> => {
  if (order.order_class !== 'mleg') return { ...order };
  if (order.legs === undefined || order.legs.length < 2 || order.legs.length > 4) throw new Error('MULTI_LEG_COUNT_INVALID');
  return {
    qty: order.qty, type: order.type, time_in_force: order.time_in_force, limit_price: order.limit_price,
    client_order_id: order.client_order_id, order_class: 'mleg', legs: order.legs,
  };
};

const activitySchema = z.object({
  net_amount: z.union([z.string().trim().min(1),z.number()]).nullable().optional(),
  per_share_amount: z.union([z.string().trim().min(1),z.number()]).nullable().optional(),
  id: providerIdentitySchema,
  activity_type: providerIdentitySchema,
  symbol: providerIdentitySchema.nullable().optional(),
  qty: strictNumericProviderField.nullable().optional(),
  price: strictNumericProviderField.nullable().optional(),
  date: providerDateOrInstantSchema.nullable().optional(),
  transaction_time: providerInstantSchema.nullable().optional(),
  order_id: providerIdentitySchema.nullable().optional(),
}).passthrough();

export const parseBrokerActivity = (raw: unknown): BrokerActivity => {
  const activity = activitySchema.parse(raw);
  return {
    id: activity.id,
    activityType: activity.activity_type,
    symbol: activity.symbol ?? null,
    quantity: nullableNumber(activity.qty),
    price: nullableNumber(activity.price),
    date: activity.transaction_time ?? activity.date ?? null,
    orderId: activity.order_id ?? null,
    netAmount: nullableNumber(activity.net_amount),
    perShareAmount: nullableNumber(activity.per_share_amount),
  };
};

export class AlpacaPaperBrokerError extends Error {
  constructor(
    readonly category: 'INVALID_AUTH' | 'NOT_ENTITLED' | 'RATE_LIMITED' | 'BROKER_REJECTED' | 'AMBIGUOUS_NETWORK' | 'MALFORMED_RESPONSE',
    readonly httpStatus: number | null,
    message: string,
    /** Provider Retry-After hint in milliseconds when the response carried a parseable one; otherwise null. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'AlpacaPaperBrokerError';
  }
}

// ---------------------------------------------------------------------------
// Read-retry / rate-limit policy (Phase 3 E1).
//
// READS (GET) retry with bounded exponential backoff + jitter, honoring Retry-After, with a hard cap on attempts AND on
// total wait. MUTATIONS (POST/PATCH/DELETE) are NEVER retried inside the adapter: a 429 on a mutation means the broker did
// not process it, and the coordinator must reconcile by client_order_id before any further action. A process-wide shared
// budget + cooldown stops concurrent worker jobs from forming a retry storm after one 429.
// ---------------------------------------------------------------------------

export interface ReadRetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxTotalWaitMs: number;
}
export const DEFAULT_READ_RETRY_POLICY: ReadRetryPolicy = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 3_000, maxTotalWaitMs: 5_000 };

export interface ReadRetryOptions {
  readonly policy?: Partial<ReadRetryPolicy>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly budget?: SharedReadRetryBudget;
}

/** Parses a Retry-After header (delta-seconds or HTTP-date). Returns null when absent or unusable; never negative. */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number): number | null {
  if (header === null || header === undefined) return null;
  const value = header.trim();
  if (value.length === 0) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

/** Per-process retry budget and rate-limit cooldown shared by every read in the process. */
export class SharedReadRetryBudget {
  private readonly stamps: number[] = [];
  private blockedUntil = 0;
  constructor(private readonly maxRetriesPerWindow = 20, private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}
  tryConsume(): boolean {
    const t = this.now();
    while (this.stamps.length > 0 && (this.stamps[0] as number) <= t - this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.maxRetriesPerWindow) return false;
    this.stamps.push(t);
    return true;
  }
  noteCooldown(untilMs: number): void { this.blockedUntil = Math.max(this.blockedUntil, untilMs); }
  cooldownRemainingMs(): number { return Math.max(0, this.blockedUntil - this.now()); }
}
export const defaultSharedReadRetryBudget = new SharedReadRetryBudget();

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before retry `attempt` (0-based); null when the provider asks for longer than maxDelayMs (give up, never sleep unboundedly). */
export function readRetryDelayMs(policy: ReadRetryPolicy, attempt: number, retryAfterMs: number | null, random: () => number): number | null {
  if (retryAfterMs !== null && retryAfterMs > policy.maxDelayMs) return null;
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  const jittered = Math.floor(backoff / 2 + random() * (backoff / 2));
  return Math.max(jittered, retryAfterMs ?? 0);
}

export interface ReadRetryVerdict { readonly retryable: boolean; readonly rateLimited: boolean; readonly retryAfterMs: number | null }

/**
 * Runs a read with the bounded retry policy. Exported so the Alpaca data provider shares the exact same limits and budget.
 * `rateLimitedError` builds the error thrown when the shared cooldown exceeds the whole wait cap (no network call is made).
 */
export async function runBoundedRead<T>(attemptOnce: () => Promise<T>, classify: (error: unknown) => ReadRetryVerdict,
  rateLimitedError: () => Error, options: ReadRetryOptions = {}): Promise<T> {
  const policy: ReadRetryPolicy = { ...DEFAULT_READ_RETRY_POLICY, ...options.policy };
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const budget = options.budget ?? defaultSharedReadRetryBudget;
  let waited = 0;
  const cooldown = budget.cooldownRemainingMs();
  if (cooldown > 0) {
    // Another job in this process just saw a 429: honor that shared cooldown (bounded) instead of adding to the storm.
    if (cooldown > policy.maxTotalWaitMs) throw rateLimitedError();
    await sleep(cooldown);
    waited += cooldown;
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attemptOnce();
    } catch (error) {
      const verdict = classify(error);
      if (!verdict.retryable || attempt >= policy.maxRetries) throw error;
      const delay = readRetryDelayMs(policy, attempt, verdict.retryAfterMs, random);
      if (delay === null || waited + delay > policy.maxTotalWaitMs || !budget.tryConsume()) throw error;
      if (verdict.rateLimited) budget.noteCooldown(now() + delay);
      await sleep(delay);
      waited += delay;
    }
  }
}

const retryableReadError = (error: AlpacaPaperBrokerError): boolean =>
  error.category === 'RATE_LIMITED' || (error.category === 'AMBIGUOUS_NETWORK' && (error.httpStatus === null || [502, 503, 504].includes(error.httpStatus)));

export interface AlpacaPaperBrokerConfig {
  readonly baseUrl: string;
  readonly authentication: AlpacaPaperAuthentication;
  readonly fetchImpl?: typeof fetch;
  /** Per-request wall-clock limit. A timeout after a mutation was sent is AMBIGUOUS_NETWORK (reconcile, never retry). Default 15s. */
  readonly requestTimeoutMs?: number;
  readonly readRetry?: ReadRetryOptions;
}

const assertPaperHost = (baseUrl: string): URL => {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'paper-api.alpaca.markets' || parsed.port !== '' || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error('Execution adapter requires the exact Alpaca PAPER host.');
  }
  return parsed;
};

const requestHeaders = (auth: AlpacaPaperAuthentication): HeadersInit => auth.kind !== 'FOLLOWER_OAUTH'
  ? { 'APCA-API-KEY-ID': auth.apiKey, 'APCA-API-SECRET-KEY': auth.apiSecret, 'Content-Type': 'application/json' }
  : { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' };

export class AlpacaPaperBrokerAdapter implements PaperBrokerAdapter {
  readonly environment = 'PAPER' as const;
  readonly accountKind: BrokerAccountKind;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: HeadersInit;
  private readonly requestTimeoutMs: number;
  private readonly readRetry: ReadRetryOptions;

  constructor(config: AlpacaPaperBrokerConfig) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? 15_000;
    this.readRetry = config.readRetry ?? {};
    this.baseUrl = assertPaperHost(config.baseUrl);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.headers = requestHeaders(config.authentication);
    this.accountKind = config.authentication.kind;
  }

  private async request(path: string, init: RequestInit = {}, allowNotFound = false): Promise<unknown> {
    const method = init.method ?? 'GET';
    const isMutation = method === 'POST' || method === 'PATCH' || method === 'DELETE';
    // Mutations are single-shot: the adapter never retries them (see the policy block above).
    if (isMutation) return this.requestOnce(path, init, allowNotFound, true);
    const now = this.readRetry.now ?? Date.now;
    return runBoundedRead(() => this.requestOnce(path, init, allowNotFound, false), (error) => {
      if (!(error instanceof AlpacaPaperBrokerError)) return { retryable: false, rateLimited: false, retryAfterMs: null };
      return { retryable: retryableReadError(error), rateLimited: error.category === 'RATE_LIMITED', retryAfterMs: error.retryAfterMs };
    }, () => new AlpacaPaperBrokerError('RATE_LIMITED', 429, `Alpaca PAPER ${path.split('?')[0]} refused locally: shared rate-limit cooldown exceeds the bounded wait.`),
    { ...this.readRetry, now });
  }

  private async requestOnce(path: string, init: RequestInit, allowNotFound: boolean, isMutation: boolean): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(path, this.baseUrl), { ...init, headers: { ...this.headers, ...init.headers }, signal: controller.signal });
      } catch (error) {
        throw new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, `Alpaca PAPER request failed before a response was available: ${controller.signal.aborted ? 'TimeoutError' : error instanceof Error ? error.name : 'NetworkError'}.`);
      }
      if (allowNotFound && response.status === 404) return ORDER_NOT_FOUND;
      if (!response.ok) {
        // Reads: 5xx/408 are transient provider unavailability (retryable, no state implication). Mutations: 5xx may have
        // been applied -> ambiguous. 429 is always "not processed".
        const transientRead = !isMutation && (response.status >= 500 || response.status === 408);
        const category = (isMutation && (response.status >= 500 || response.status === 408)) || transientRead ? 'AMBIGUOUS_NETWORK'
          : response.status === 401 ? 'INVALID_AUTH'
          : response.status === 403 ? 'NOT_ENTITLED'
            : response.status === 429 ? 'RATE_LIMITED'
              : 'BROKER_REJECTED';
        const retryAfterMs = response.status === 429 || response.status === 503
          ? parseRetryAfterMs(response.headers?.get?.('retry-after'), (this.readRetry.now ?? Date.now)()) : null;
        throw new AlpacaPaperBrokerError(category, response.status, `Alpaca PAPER ${new URL(path, this.baseUrl).pathname} returned HTTP ${response.status}.`, retryAfterMs);
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new AlpacaPaperBrokerError(isMutation || controller.signal.aborted ? 'AMBIGUOUS_NETWORK' : 'MALFORMED_RESPONSE', response.status,
          'Alpaca PAPER returned an invalid JSON response.');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private parseProviderPayload<T>(operation: string, parser: () => T, mutation = false): T {
    try {
      return parser();
    } catch (error) {
      if (error instanceof AlpacaPaperBrokerError) throw error;
      throw new AlpacaPaperBrokerError(mutation ? 'AMBIGUOUS_NETWORK' : 'MALFORMED_RESPONSE', 200,
        `Alpaca PAPER ${operation} returned a malformed success payload [shape: ${describeProviderShapeFailure(error)}].`);
    }
  }

  getAccount(): Promise<unknown> { return this.request('/v2/account'); }
  async getPositions(): Promise<readonly unknown[]> {
    const body = await this.request('/v2/positions');
    return this.parseProviderPayload('/v2/positions', () => z.array(z.unknown()).parse(body));
  }
  async getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<readonly BrokerOrderSnapshot[]> {
    const body = await this.request(`/v2/orders?status=${status}&nested=true&limit=500`);
    return this.parseProviderPayload('/v2/orders', () => z.array(z.unknown()).parse(body)
      .flatMap((raw, rowIndex) => (isTerminalNonThetaClassOrder(raw) ? [] : [parseBrokerOrderRow(raw, rowIndex)])));
  }
  async getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null> {
    const body = await this.request(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, {}, true);
    if (body === ORDER_NOT_FOUND) return null;
    // Alpaca documents `nested=true` only on the order-by-id endpoint. If the
    // client-id lookup returns an mleg parent without its legs, resolve that
    // parent by id before reconciliation rather than treating missing legs as
    // proof of an invalid or atomic fill.
    const parent = z.object({ id: providerIdentitySchema, order_class: z.literal('mleg'),
      legs: z.array(z.unknown()).optional() }).passthrough().safeParse(body);
    if (parent.success && (parent.data.legs === undefined || parent.data.legs.length === 0)) {
      return this.getOrder(parent.data.id);
    }
    return this.parseProviderPayload('/v2/orders:by_client_order_id', () => parseBrokerOrder(body));
  }
  async getOrder(providerOrderId: string): Promise<BrokerOrderSnapshot | null> {
    const body = await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}?nested=true`, {}, true);
    return body === ORDER_NOT_FOUND ? null : this.parseProviderPayload('/v2/orders/{id}', () => parseBrokerOrder(body));
  }
  async getActivities(activityTypes?: readonly string[]): Promise<readonly BrokerActivity[]> {
    const activities: BrokerActivity[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ direction: 'asc', page_size: '100' });
      if (activityTypes !== undefined && activityTypes.length > 0) query.set('activity_types', activityTypes.join(','));
      if (pageToken !== null) query.set('page_token', pageToken);
      const payload = await this.request(`/v2/account/activities?${query.toString()}`);
      const parsed = this.parseProviderPayload('/v2/account/activities', () =>
        z.array(z.unknown()).parse(payload).map(parseBrokerActivity));
      activities.push(...parsed);
      if (parsed.length < 100) return activities;
      pageToken = parsed.at(-1)?.id ?? null;
      if (pageToken === null) throw new AlpacaPaperBrokerError('MALFORMED_RESPONSE', null, 'Alpaca activity pagination did not provide a usable final activity ID.');
    }
    throw new AlpacaPaperBrokerError('MALFORMED_RESPONSE', null, 'Alpaca activity pagination exceeded the bounded reconciliation window.');
  }
  async getClock(): Promise<BrokerMarketClock> {
    const payload = await this.request('/v2/clock');
    const body = this.parseProviderPayload('/v2/clock', () => z.object({
      timestamp: providerInstantSchema.nullable().optional(), is_open: z.boolean().nullable().optional(),
      next_open: providerInstantSchema.nullable().optional(), next_close: providerInstantSchema.nullable().optional(),
    }).passthrough().parse(payload));
    return {
      timestamp: body.timestamp ?? null, isOpen: body.is_open ?? null,
      nextOpen: body.next_open ?? null, nextClose: body.next_close ?? null,
    };
  }
  async getCalendar(start: string, end: string): Promise<readonly BrokerCalendarSession[]> {
    const query = new URLSearchParams({ start, end });
    const payload = await this.request(`/v2/calendar?${query.toString()}`);
    const body = this.parseProviderPayload('/v2/calendar', () => z.array(z.object({
      date: providerDateSchema, open: marketTimeSchema.nullable().optional(), close: marketTimeSchema.nullable().optional(),
    }).passthrough()).parse(payload));
    return body.map((session) => ({ date: session.date, open: session.open ?? null, close: session.close ?? null }));
  }
  async submitOrder(order: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    assertBrokerMutationAuthorized(authorization, order.client_order_id, order.qty, 'SUBMIT');
    const payload = await this.request('/v2/orders', { method: 'POST', body: JSON.stringify(brokerPayloadForOrder(order)) });
    return this.parseProviderPayload('/v2/orders', () => parseBrokerOrder(payload), true);
  }
  async replaceOrder(providerOrderId: string, replacement: Pick<BrokerOrderRequest, 'qty' | 'limit_price' | 'time_in_force' | 'client_order_id'>, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    assertBrokerMutationAuthorized(authorization, replacement.client_order_id, replacement.qty, 'REPLACE');
    const payload = await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, { method: 'PATCH', body: JSON.stringify(replacement) });
    return this.parseProviderPayload('/v2/orders/{id}', () => parseBrokerOrder(payload), true);
  }
  async cancelOrder(providerOrderId: string, authorization: BrokerMutationAuthorization): Promise<void> {
    assertBrokerMutationAuthorized(authorization, undefined, undefined, 'CANCEL');
    await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, { method: 'DELETE' });
  }
}

export const hashBrokerPayload = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
