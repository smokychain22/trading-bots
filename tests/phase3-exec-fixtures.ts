// Phase 3 E1 shared offline fixtures: a stateful fake Alpaca PAPER server (served through an injected fetch) with scripted
// fault injection, standard intents, gates and an optional disposable-Postgres pool. No real network, no real credentials.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AlpacaPaperBrokerAdapter, SharedReadRetryBudget, type BrokerOrderRequest } from '../src/execution/broker.js';
import type { ExecutionGateContext, PaperExecutionControl } from '../src/execution/execution-control.js';
import { InMemoryPaperOrderStore, PaperOrderCoordinator, type PaperOrderGate, type PaperOrderStore, type PrepareIntentInput } from '../src/execution/paper-order-coordinator.js';
import { PostgresPaperOrderStore } from '../src/execution/postgres-paper-order-store.js';
import { generateClientOrderId } from '../src/theta/order-intent-state.js';

export type RawOrder = Record<string, unknown> & { id: string; client_order_id: string; status: string; qty: string; filled_qty: string };

export type FaultResponse =
  | { readonly kind: 'status'; readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }
  | { readonly kind: 'network'; readonly code: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'body'; readonly body: string; readonly status?: number; readonly contentType?: string }
  | { readonly kind: 'truncated' };

export interface FaultSpec {
  /** `${METHOD} ${normalized path}`, e.g. 'POST /v2/orders', 'GET /v2/orders:by_client_order_id', 'DELETE /v2/orders/{id}'. */
  readonly op: string;
  /** Number of matching requests to fault; 'always' never expires. Default 1. */
  readonly times?: number | 'always';
  /** true: the server applies the mutation, THEN the client sees the fault (lost response). Default false (never applied). */
  readonly applied?: boolean;
  /** Runs just before the request is handled (models a broker-side race, e.g. the order fills between our read and the DELETE). */
  readonly before?: (server: FakeAlpaca) => void;
  readonly respond: FaultResponse;
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const TERMINAL = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced', 'done_for_day']);

export class FakeAlpaca {
  readonly orders = new Map<string, RawOrder>();
  readonly log: Array<{ method: string; op: string; search: string }> = [];
  private readonly faults: Array<FaultSpec & { remaining: number | 'always' }> = [];
  private seq = 0;
  /** Number of orders ever created by POST (the economic-duplicate counter). */
  created = 0;
  duplicateClientIdRejections = 0;
  /** DELETE leaves 'pending_cancel' instead of an immediate 'canceled' when true. */
  cancelPending = false;

  inject(fault: FaultSpec): this { this.faults.push({ ...fault, remaining: fault.times ?? 1 }); return this; }
  count(op: string): number { return this.log.filter((entry) => entry.op === op).length; }
  mutationCount(): number { return this.log.filter((entry) => entry.method !== 'GET').length; }
  byClient(clientOrderId: string): RawOrder | undefined { return [...this.orders.values()].find((order) => order.client_order_id === clientOrderId); }
  /** Broker-side progress that the bot did not cause (fills, expiry). */
  patch(clientOrderId: string, patch: Partial<RawOrder>): void {
    const order = this.byClient(clientOrderId);
    if (order === undefined) throw new Error('FakeAlpaca: no such order');
    Object.assign(order, patch);
  }
  seed(request: BrokerOrderRequest): RawOrder { return this.create(request); }

  private create(request: Pick<BrokerOrderRequest, 'symbol' | 'qty' | 'side' | 'limit_price' | 'client_order_id' | 'position_intent'>, extra: Partial<RawOrder> = {}): RawOrder {
    this.seq += 1;
    this.created += 1;
    const order: RawOrder = {
      id: `ord-${this.seq}`, client_order_id: request.client_order_id, symbol: request.symbol, qty: String(request.qty), filled_qty: '0',
      filled_avg_price: null, side: request.side, position_intent: request.position_intent ?? null, status: 'accepted',
      limit_price: request.limit_price, submitted_at: '2026-10-02T14:30:00Z', replaced_by: null, replaces: null, ...extra,
    };
    this.orders.set(order.id, order);
    return order;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const op = `${method} ${url.pathname.replace(/^\/v2\/orders\/(?!$)[^/]+$/, '/v2/orders/{id}')}`;
    this.log.push({ method, op, search: url.search });
    const index = this.faults.findIndex((fault) => fault.op === op && (fault.remaining === 'always' || fault.remaining > 0));
    if (index === -1) return this.handle(method, url, init);
    const fault = this.faults[index] as FaultSpec & { remaining: number | 'always' };
    if (fault.remaining !== 'always') fault.remaining -= 1;
    fault.before?.(this);
    if (fault.applied === true) this.handle(method, url, init);
    return this.fault(fault.respond, init);
  };

  private fault(response: FaultResponse, init?: RequestInit): Promise<Response> {
    switch (response.kind) {
      case 'network': return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(response.code), { code: response.code }) }));
      case 'timeout': return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      case 'status': return Promise.resolve(new Response(response.body ?? '{"message":"fault"}', { status: response.status, headers: response.headers }));
      case 'body': return Promise.resolve(new Response(response.body, { status: response.status ?? 200, headers: { 'content-type': response.contentType ?? 'application/json' } }));
      case 'truncated': {
        const stream = new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"ord-1","client_ord'));
          controller.error(new TypeError('terminated'));
        } });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }));
      }
    }
  }

  private handle(method: string, url: URL, init?: RequestInit): Response {
    const path = url.pathname;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (method === 'POST' && path === '/v2/orders') {
      const request = body as unknown as BrokerOrderRequest;
      if (this.byClient(request.client_order_id) !== undefined) {
        this.duplicateClientIdRejections += 1;
        return jsonResponse({ message: 'client_order_id must be unique' }, 422);
      }
      return jsonResponse(this.create(request));
    }
    if (method === 'GET' && path === '/v2/orders:by_client_order_id') {
      const found = this.byClient(url.searchParams.get('client_order_id') ?? '');
      return found === undefined ? jsonResponse({ message: 'order not found' }, 404) : jsonResponse(found);
    }
    if (method === 'GET' && path === '/v2/orders') {
      const status = url.searchParams.get('status') ?? 'open';
      return jsonResponse([...this.orders.values()].filter((order) => status === 'all' || (status === 'open') === !TERMINAL.has(order.status)));
    }
    if (method === 'GET' && path === '/v2/positions') return jsonResponse([]);
    const match = /^\/v2\/orders\/([^/]+)$/.exec(path);
    if (match !== null) {
      const order = this.orders.get(decodeURIComponent(match[1] as string));
      if (method === 'GET') return order === undefined ? jsonResponse({ message: 'order not found' }, 404) : jsonResponse(order);
      if (order === undefined) return jsonResponse({ message: 'order not found' }, 404);
      if (method === 'DELETE') {
        if (TERMINAL.has(order.status)) return jsonResponse({ message: 'order is not cancelable' }, 422);
        order.status = this.cancelPending ? 'pending_cancel' : 'canceled';
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        if (TERMINAL.has(order.status)) return jsonResponse({ message: 'order is not replaceable' }, 422);
        const clientOrderId = String(body.client_order_id);
        if (this.byClient(clientOrderId) !== undefined) { this.duplicateClientIdRejections += 1; return jsonResponse({ message: 'client_order_id must be unique' }, 422); }
        const replacement = this.create({ symbol: order.symbol as string, qty: Number(body.qty), side: order.side as 'buy' | 'sell',
          limit_price: String(body.limit_price), client_order_id: clientOrderId, position_intent: order.position_intent as BrokerOrderRequest['position_intent'] },
        { replaces: order.id, filled_qty: order.filled_qty });
        order.status = 'replaced';
        order.replaced_by = replacement.id;
        return jsonResponse(replacement);
      }
    }
    return jsonResponse({ message: 'unrouted' }, 404);
  }
}

export const control = (overrides: Partial<PaperExecutionControl> = {}): PaperExecutionControl => ({ masterEnabled: true, followerEnabled: false, pauseNewOrders: false, ...overrides });

export const optionGate: PaperOrderGate = {
  baseHostname: 'paper-api.alpaca.markets', accountVerified: true, optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL',
  quoteFresh: true, decisionExpiresAt: '2026-10-02T15:00:00.000Z', now: '2026-10-02T14:00:00.000Z', isNewEntry: true, priceEvidence: 'QUALIFIED_OPTION_BBO',
};
export const stockGate: PaperOrderGate = { ...optionGate, isNewEntry: false, priceEvidence: 'ALPACA_STOCK_BBO' };
export type GateOf = ExecutionGateContext;

export interface IntentOverrides { readonly orderIntentId?: string; readonly decisionId?: string; readonly qty?: number; readonly limit?: string; readonly attempt?: number; readonly accountId?: string }

export function optionIntent(over: IntentOverrides = {}): PrepareIntentInput {
  const decisionId = over.decisionId ?? randomUUID();
  const qty = over.qty ?? 3;
  return {
    orderIntentId: over.orderIntentId ?? randomUUID(), executionAccountId: over.accountId ?? '22222222-2222-4222-8222-222222222222', decisionId, action: 'OPEN_CSP',
    request: { symbol: 'AAPL261016P00150000', qty, side: 'sell', type: 'limit', time_in_force: 'day', limit_price: over.limit ?? '1.25',
      client_order_id: generateClientOrderId(decisionId, 'candidate-1', over.attempt ?? 1), position_intent: 'sell_to_open' },
    persistedAt: optionGate.now, chainId: randomUUID(), optionContractId: randomUUID(), underlyingId: randomUUID(),
    executionEvidence: { quoteSource: 'ALPACA', quoteFeed: 'OPRA', quoteSemantics: 'CONSOLIDATED_NBBO', quoteAsOf: '2026-10-02T14:00:00.000Z',
      decisionExpiresAt: '2026-10-02T15:00:00.000Z', quoteContentHash: 'a'.repeat(64), aegisState: 'ALLOW_FULL' },
    authorizationEvidence: { executionTier: 'PAPER_EVIDENCE', canonicalQuantity: qty, paperEvidenceQuantity: qty, empiricalEconomicsReady: false, expectedAfterCostEv: null },
  };
}

export function stockIntent(over: IntentOverrides = {}): PrepareIntentInput {
  const base = optionIntent({ ...over, qty: over.qty ?? 100 });
  const request: Record<string, unknown> = { ...base.request };
  delete request.position_intent;
  return { ...base, action: 'SELL_STOCK', request: { ...request, symbol: 'AAPL' } as unknown as PrepareIntentInput['request'], optionContractId: null,
    executionEvidence: { ...base.executionEvidence, quoteFeed: 'IEX' } };
}

/** A replacement intent for `original` (same lineage, new client_order_id, new limit, optionally smaller total quantity). */
export function replacementOf(original: PrepareIntentInput, over: { qty?: number; limit?: string; attempt?: number } = {}): PrepareIntentInput {
  const qty = over.qty ?? original.request.qty;
  return { ...original, orderIntentId: randomUUID(),
    request: { ...original.request, qty, limit_price: over.limit ?? '1.20', client_order_id: generateClientOrderId(original.decisionId, 'candidate-1', over.attempt ?? 2) },
    authorizationEvidence: { ...original.authorizationEvidence, paperEvidenceQuantity: qty } };
}

export interface Rig {
  readonly server: FakeAlpaca;
  readonly adapter: AlpacaPaperBrokerAdapter;
  readonly store: PaperOrderStore;
  readonly coordinator: PaperOrderCoordinator;
  readonly sleeps: number[];
}

export function makeRig(options: { server?: FakeAlpaca; store?: PaperOrderStore; control?: PaperExecutionControl; requestTimeoutMs?: number; maxRetries?: number } = {}): Rig {
  const server = options.server ?? new FakeAlpaca();
  const sleeps: number[] = [];
  const adapter = new AlpacaPaperBrokerAdapter({
    baseUrl: 'https://paper-api.alpaca.markets', authentication: { kind: 'MASTER_API_KEY', apiKey: 'SYNTHETIC', apiSecret: 'SYNTHETIC' },
    fetchImpl: server.fetch, requestTimeoutMs: options.requestTimeoutMs ?? 25,
    readRetry: { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, budget: new SharedReadRetryBudget(1000, 60_000),
      policy: { maxRetries: options.maxRetries ?? 2 } },
  });
  const store = options.store ?? new InMemoryPaperOrderStore();
  return { server, adapter, store, coordinator: new PaperOrderCoordinator(adapter, store, options.control ?? control()), sleeps };
}

// ---- optional disposable Postgres (THETA_P3_E1_DATABASE_URL must point at the throwaway database; absent => DB tests skip) ----
export const databaseUrl = process.env.THETA_P3_E1_DATABASE_URL;
export const dbSkip = databaseUrl === undefined ? 'THETA_P3_E1_DATABASE_URL not set (disposable DB required)' : false;
export function openPool(): Pool { return new Pool({ connectionString: databaseUrl, max: 8 }); }

/**
 * The throwaway database named by THETA_P3_E1_DATABASE_URL has no decision graph behind its order intents, so the foreign keys of the
 * execution tables are dropped there. DESTRUCTIVE: refuses any database whose name does not start with theta_p3_ (never Production,
 * never a shared CI database).
 */
export async function relaxExecutionForeignKeys(pool: Pool): Promise<void> {
  const name = new URL(databaseUrl as string).pathname.replace(/^\//, '');
  if (!/^theta_p3_[a-z0-9_]+$/.test(name)) throw new Error('RELAX_FOREIGN_KEYS_REFUSED_NOT_A_THROWAWAY_DATABASE');
  for (const table of ['order_intent', 'execution_attempt', 'broker_order', 'fill']) {
    const keys = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('trade.'||$1) AND contype='f'`, [table]);
    for (const row of keys.rows) await pool.query(`ALTER TABLE trade.${table} DROP CONSTRAINT IF EXISTS ${row.conname}`);
  }
}
export function postgresStore(pool: Pool, accountId?: string): PostgresPaperOrderStore { return new PostgresPaperOrderStore(pool, accountId); }
