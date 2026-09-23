import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertBrokerMutationAuthorized, type BrokerMutationAuthorization } from './execution-control.js';

export type BrokerAccountKind = 'MASTER_API_KEY' | 'FOLLOWER_API_KEY' | 'FOLLOWER_OAUTH';

export type AlpacaPaperAuthentication =
  | { readonly kind: 'MASTER_API_KEY'; readonly apiKey: string; readonly apiSecret: string }
  | { readonly kind: 'FOLLOWER_API_KEY'; readonly apiKey: string; readonly apiSecret: string }
  | { readonly kind: 'FOLLOWER_OAUTH'; readonly accessToken: string };

export interface BrokerOrderRequest {
  readonly symbol: string;
  readonly qty: number;
  readonly side: 'buy' | 'sell';
  readonly type: 'limit';
  readonly time_in_force: 'day';
  readonly limit_price: string;
  readonly client_order_id: string;
  readonly position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
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

const rawOrderSchema = z.object({
  id: providerIdentitySchema,
  client_order_id: providerIdentitySchema,
  symbol: providerIdentitySchema,
  qty: strictNumericProviderField,
  filled_qty: strictNumericProviderField,
  filled_avg_price: strictNumericProviderField.nullable().optional(),
  side: z.enum(['buy', 'sell']),
  position_intent: z.enum(['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close']).nullable().optional(),
  status: providerIdentitySchema,
  limit_price: strictNumericProviderField.nullable().optional(),
  submitted_at: providerInstantSchema.nullable().optional(),
  replaced_by: providerIdentitySchema.nullable().optional(),
  replaces: providerIdentitySchema.nullable().optional(),
}).passthrough();

const finiteNumber = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Alpaca returned a non-finite numeric field.');
  return parsed;
};

const nullableNumber = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : finiteNumber(value);

export const parseBrokerOrder = (raw: unknown): BrokerOrderSnapshot => {
  const order = rawOrderSchema.parse(raw);
  const qty = finiteNumber(order.qty);
  const filledQty = finiteNumber(order.filled_qty);
  const filledAvgPrice = nullableNumber(order.filled_avg_price);
  const limitPrice = nullableNumber(order.limit_price);
  if (qty <= 0) throw new Error('Alpaca returned an invalid order quantity.');
  if (filledQty < 0 || filledQty > qty) throw new Error('Alpaca returned an invalid filled order quantity.');
  if (filledAvgPrice !== null && filledAvgPrice <= 0) throw new Error('Alpaca returned an invalid filled average price.');
  if (limitPrice !== null && limitPrice <= 0) throw new Error('Alpaca returned an invalid limit price.');
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    qty,
    filledQty,
    filledAvgPrice,
    side: order.side,
    positionIntent: order.position_intent ?? null,
    status: order.status,
    limitPrice,
    submittedAt: order.submitted_at ?? null,
    replacedBy: order.replaced_by ?? null,
    replaces: order.replaces ?? null,
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
  ) {
    super(message);
    this.name = 'AlpacaPaperBrokerError';
  }
}

export interface AlpacaPaperBrokerConfig {
  readonly baseUrl: string;
  readonly authentication: AlpacaPaperAuthentication;
  readonly fetchImpl?: typeof fetch;
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

  constructor(config: AlpacaPaperBrokerConfig) {
    this.baseUrl = assertPaperHost(config.baseUrl);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.headers = requestHeaders(config.authentication);
    this.accountKind = config.authentication.kind;
  }

  private async request(path: string, init: RequestInit = {}, allowNotFound = false): Promise<unknown> {
    const method = init.method ?? 'GET';
    const isMutation = method === 'POST' || method === 'PATCH' || method === 'DELETE';
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), { ...init, headers: { ...this.headers, ...init.headers } });
    } catch (error) {
      throw new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, `Alpaca PAPER request failed before a response was available: ${error instanceof Error ? error.name : 'NetworkError'}.`);
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const category = isMutation && response.status >= 500 ? 'AMBIGUOUS_NETWORK'
        : response.status === 401 ? 'INVALID_AUTH'
        : response.status === 403 ? 'NOT_ENTITLED'
          : response.status === 429 ? 'RATE_LIMITED'
            : 'BROKER_REJECTED';
      throw new AlpacaPaperBrokerError(category, response.status, `Alpaca PAPER ${new URL(path, this.baseUrl).pathname} returned HTTP ${response.status}.`);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new AlpacaPaperBrokerError(isMutation ? 'AMBIGUOUS_NETWORK' : 'MALFORMED_RESPONSE', response.status,
        'Alpaca PAPER returned an invalid JSON response.');
    }
  }

  private parseProviderPayload<T>(operation: string, parser: () => T, mutation = false): T {
    try {
      return parser();
    } catch (error) {
      if (error instanceof AlpacaPaperBrokerError) throw error;
      throw new AlpacaPaperBrokerError(mutation ? 'AMBIGUOUS_NETWORK' : 'MALFORMED_RESPONSE', 200,
        `Alpaca PAPER ${operation} returned a malformed success payload.`);
    }
  }

  getAccount(): Promise<unknown> { return this.request('/v2/account'); }
  async getPositions(): Promise<readonly unknown[]> {
    const body = await this.request('/v2/positions');
    return this.parseProviderPayload('/v2/positions', () => z.array(z.unknown()).parse(body));
  }
  async getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<readonly BrokerOrderSnapshot[]> {
    const body = await this.request(`/v2/orders?status=${status}&nested=true&limit=500`);
    return this.parseProviderPayload('/v2/orders', () => z.array(z.unknown()).parse(body).map(parseBrokerOrder));
  }
  async getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null> {
    const body = await this.request(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, {}, true);
    return body === null ? null : this.parseProviderPayload('/v2/orders:by_client_order_id', () => parseBrokerOrder(body));
  }
  async getOrder(providerOrderId: string): Promise<BrokerOrderSnapshot | null> {
    const body = await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, {}, true);
    return body === null ? null : this.parseProviderPayload('/v2/orders/{id}', () => parseBrokerOrder(body));
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
    const payload = await this.request('/v2/orders', { method: 'POST', body: JSON.stringify(order) });
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
