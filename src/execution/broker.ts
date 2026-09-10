import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertBrokerMutationAuthorized, type BrokerMutationAuthorization } from './execution-control.js';

export type BrokerAccountKind = 'MASTER_API_KEY' | 'FOLLOWER_OAUTH';

export type AlpacaPaperAuthentication =
  | { readonly kind: 'MASTER_API_KEY'; readonly apiKey: string; readonly apiSecret: string }
  | { readonly kind: 'FOLLOWER_OAUTH'; readonly accessToken: string };

export interface BrokerOrderRequest {
  readonly symbol: string;
  readonly qty: number;
  readonly side: 'buy' | 'sell';
  readonly type: 'limit';
  readonly time_in_force: 'day';
  readonly limit_price: string;
  readonly client_order_id: string;
}

export interface BrokerOrderSnapshot {
  readonly id: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly qty: number;
  readonly filledQty: number;
  readonly filledAvgPrice: number | null;
  readonly side: 'buy' | 'sell';
  readonly status: string;
  readonly limitPrice: number | null;
  readonly submittedAt: string | null;
  readonly replacedBy: string | null;
  readonly replaces: string | null;
}

export interface BrokerActivity {
  readonly id: string;
  readonly activityType: string;
  readonly symbol: string | null;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly date: string | null;
  readonly orderId: string | null;
}

export interface PaperBrokerAdapter {
  readonly accountKind: BrokerAccountKind;
  readonly environment: 'PAPER';
  getAccount(): Promise<unknown>;
  getPositions(): Promise<readonly unknown[]>;
  getOrders(status?: 'open' | 'closed' | 'all'): Promise<readonly BrokerOrderSnapshot[]>;
  getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null>;
  getActivities(activityTypes?: readonly string[]): Promise<readonly BrokerActivity[]>;
  submitOrder(order: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot>;
  replaceOrder(providerOrderId: string, replacement: Pick<BrokerOrderRequest, 'qty' | 'limit_price' | 'time_in_force' | 'client_order_id'>, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot>;
  cancelOrder(providerOrderId: string, authorization: BrokerMutationAuthorization): Promise<void>;
}

const rawOrderSchema = z.object({
  id: z.string().min(1),
  client_order_id: z.string().min(1),
  symbol: z.string().min(1),
  qty: z.union([z.string(), z.number()]),
  filled_qty: z.union([z.string(), z.number()]).default('0'),
  filled_avg_price: z.union([z.string(), z.number()]).nullable().optional(),
  side: z.enum(['buy', 'sell']),
  status: z.string().min(1),
  limit_price: z.union([z.string(), z.number()]).nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  replaced_by: z.string().nullable().optional(),
  replaces: z.string().nullable().optional(),
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
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    qty: finiteNumber(order.qty),
    filledQty: finiteNumber(order.filled_qty),
    filledAvgPrice: nullableNumber(order.filled_avg_price),
    side: order.side,
    status: order.status,
    limitPrice: nullableNumber(order.limit_price),
    submittedAt: order.submitted_at ?? null,
    replacedBy: order.replaced_by ?? null,
    replaces: order.replaces ?? null,
  };
};

const activitySchema = z.object({
  id: z.string().min(1),
  activity_type: z.string().min(1),
  symbol: z.string().nullable().optional(),
  qty: z.union([z.string(), z.number()]).nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  date: z.string().nullable().optional(),
  transaction_time: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
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

const requestHeaders = (auth: AlpacaPaperAuthentication): HeadersInit => auth.kind === 'MASTER_API_KEY'
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
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), { ...init, headers: { ...this.headers, ...init.headers } });
    } catch (error) {
      throw new AlpacaPaperBrokerError('AMBIGUOUS_NETWORK', null, `Alpaca PAPER request failed before a response was available: ${error instanceof Error ? error.name : 'NetworkError'}.`);
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const category = response.status === 401 ? 'INVALID_AUTH'
        : response.status === 403 ? 'NOT_ENTITLED'
          : response.status === 429 ? 'RATE_LIMITED'
            : 'BROKER_REJECTED';
      throw new AlpacaPaperBrokerError(category, response.status, `Alpaca PAPER ${new URL(path, this.baseUrl).pathname} returned HTTP ${response.status}.`);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new AlpacaPaperBrokerError('MALFORMED_RESPONSE', response.status, 'Alpaca PAPER returned an invalid JSON response.');
    }
  }

  getAccount(): Promise<unknown> { return this.request('/v2/account'); }
  async getPositions(): Promise<readonly unknown[]> {
    const body = await this.request('/v2/positions');
    return z.array(z.unknown()).parse(body);
  }
  async getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<readonly BrokerOrderSnapshot[]> {
    const body = await this.request(`/v2/orders?status=${status}&nested=true&limit=500`);
    return z.array(z.unknown()).parse(body).map(parseBrokerOrder);
  }
  async getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null> {
    const body = await this.request(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, {}, true);
    return body === null ? null : parseBrokerOrder(body);
  }
  async getActivities(activityTypes: readonly string[] = ['FILL', 'OPASN', 'OPEXP', 'OPXRC', 'OPEXC', 'OPTRD']): Promise<readonly BrokerActivity[]> {
    const activities: BrokerActivity[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ activity_types: activityTypes.join(','), direction: 'asc', page_size: '100' });
      if (pageToken !== null) query.set('page_token', pageToken);
      const body = z.array(z.unknown()).parse(await this.request(`/v2/account/activities?${query.toString()}`));
      const parsed = body.map(parseBrokerActivity);
      activities.push(...parsed);
      if (parsed.length < 100) return activities;
      pageToken = parsed.at(-1)?.id ?? null;
      if (pageToken === null) throw new AlpacaPaperBrokerError('MALFORMED_RESPONSE', null, 'Alpaca activity pagination did not provide a usable final activity ID.');
    }
    throw new AlpacaPaperBrokerError('MALFORMED_RESPONSE', null, 'Alpaca activity pagination exceeded the bounded reconciliation window.');
  }
  async submitOrder(order: BrokerOrderRequest, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    assertBrokerMutationAuthorized(authorization, order.client_order_id, order.qty);
    return parseBrokerOrder(await this.request('/v2/orders', { method: 'POST', body: JSON.stringify(order) }));
  }
  async replaceOrder(providerOrderId: string, replacement: Pick<BrokerOrderRequest, 'qty' | 'limit_price' | 'time_in_force' | 'client_order_id'>, authorization: BrokerMutationAuthorization): Promise<BrokerOrderSnapshot> {
    assertBrokerMutationAuthorized(authorization, replacement.client_order_id, replacement.qty);
    return parseBrokerOrder(await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, { method: 'PATCH', body: JSON.stringify(replacement) }));
  }
  async cancelOrder(providerOrderId: string, authorization: BrokerMutationAuthorization): Promise<void> {
    assertBrokerMutationAuthorized(authorization);
    await this.request(`/v2/orders/${encodeURIComponent(providerOrderId)}`, { method: 'DELETE' });
  }
}

export const hashBrokerPayload = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
