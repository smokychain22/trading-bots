import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OrderIntentState } from '../theta/order-intent-state.js';

const updateSchema = z.object({
  stream: z.literal('trade_updates'),
  data: z.object({
    event_id: z.string().min(1).optional(),
    event: z.string().min(1),
    execution_id: z.string().min(1).optional(),
    timestamp: z.string().min(1).optional(),
    at: z.string().min(1).optional(),
    qty: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    order: z.object({
      id: z.string().min(1),
      client_order_id: z.string().min(1),
      status: z.string().min(1),
      filled_qty: z.union([z.string(), z.number()]).default('0'),
      filled_avg_price: z.union([z.string(), z.number()]).nullable().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export interface NormalizedTradeUpdate {
  readonly eventId: string;
  readonly event: string;
  readonly providerOrderId: string;
  readonly clientOrderId: string;
  readonly providerFillId: string | null;
  readonly eventTime: string | null;
  readonly fillQuantity: number | null;
  readonly fillPrice: number | null;
  readonly cumulativeFilledQuantity: number;
  readonly orderState: OrderIntentState | null;
  readonly payloadHash: string;
}

const numeric = (value: string | number | undefined | null): number | null => {
  if (value === undefined || value === null) return null;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('Trade update contained a non-finite number.');
  return result;
};

const statusMap: Readonly<Record<string, OrderIntentState>> = {
  accepted: 'ACKNOWLEDGED', new: 'ACKNOWLEDGED', pending_new: 'SUBMITTED', partially_filled: 'PARTIAL', fill: 'FILLED', filled: 'FILLED',
  canceled: 'CANCELED', expired: 'EXPIRED', rejected: 'REJECTED', replaced: 'CANCELED', pending_cancel: 'CANCEL_REQUESTED',
};

export function parseTradeUpdate(raw: unknown): NormalizedTradeUpdate {
  const parsed = updateSchema.parse(raw);
  const data = parsed.data;
  const canonical = JSON.stringify(raw);
  const payloadHash = createHash('sha256').update(canonical).digest('hex');
  const eventId = data.event_id ?? data.execution_id ?? createHash('sha256').update(`${data.order.id}:${data.event}:${data.timestamp ?? data.at ?? ''}:${payloadHash}`).digest('hex');
  return {
    eventId,
    event: data.event,
    providerOrderId: data.order.id,
    clientOrderId: data.order.client_order_id,
    providerFillId: data.execution_id ?? null,
    eventTime: data.timestamp ?? data.at ?? null,
    fillQuantity: numeric(data.qty),
    fillPrice: numeric(data.price),
    cumulativeFilledQuantity: numeric(data.order.filled_qty) ?? 0,
    orderState: statusMap[data.event] ?? statusMap[data.order.status] ?? null,
    payloadHash,
  };
}

export interface AppliedTradeUpdate {
  readonly duplicate: boolean;
  readonly state: OrderIntentState | null;
  readonly fillRecorded: boolean;
}

export class TradeUpdateReconciler {
  private readonly eventIds = new Set<string>();
  private readonly fillIds = new Set<string>();
  readonly updates: NormalizedTradeUpdate[] = [];

  apply(raw: unknown): AppliedTradeUpdate {
    const update = parseTradeUpdate(raw);
    if (this.eventIds.has(update.eventId)) return { duplicate: true, state: update.orderState, fillRecorded: false };
    this.eventIds.add(update.eventId);
    this.updates.push(update);
    let fillRecorded = false;
    if (update.providerFillId !== null && update.fillQuantity !== null && update.fillQuantity > 0 && update.fillPrice !== null) {
      fillRecorded = !this.fillIds.has(update.providerFillId);
      this.fillIds.add(update.providerFillId);
    }
    return { duplicate: false, state: update.orderState, fillRecorded };
  }
}

export const tradeUpdateWebSocketUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  if (url.hostname !== 'paper-api.alpaca.markets' || url.protocol !== 'https:') throw new Error('Trade updates require Alpaca PAPER.');
  return 'wss://paper-api.alpaca.markets/stream';
};

export const tradeUpdateAuthenticationMessage = (auth: { readonly kind: 'MASTER_API_KEY'; readonly apiKey: string; readonly apiSecret: string } | { readonly kind: 'FOLLOWER_OAUTH'; readonly accessToken: string }): unknown => auth.kind === 'MASTER_API_KEY'
  ? { action: 'auth', key: auth.apiKey, secret: auth.apiSecret }
  : { action: 'auth', key: 'oauth', secret: auth.accessToken };

export const tradeUpdateListenMessage = { action: 'listen', data: { streams: ['trade_updates'] } } as const;

export interface TradeUpdateSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { readonly data?: unknown }) => void): void;
}

export type TradeUpdateSocketFactory = (url: string) => TradeUpdateSocket;

const decodeSocketData = async (data: unknown): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  throw new Error('Unsupported Alpaca trade_updates frame type.');
};

export interface TradeUpdateSession {
  readonly state: 'LISTENING';
  close(): void;
}

export function connectTradeUpdates(
  baseUrl: string,
  auth: { readonly kind: 'MASTER_API_KEY'; readonly apiKey: string; readonly apiSecret: string } | { readonly kind: 'FOLLOWER_OAUTH'; readonly accessToken: string },
  onUpdate: (update: NormalizedTradeUpdate) => Promise<void>,
  socketFactory: TradeUpdateSocketFactory = (url) => new WebSocket(url) as unknown as TradeUpdateSocket,
  timeoutMs = 10_000,
): Promise<TradeUpdateSession> {
  return new Promise((resolve, reject) => {
    const socket = socketFactory(tradeUpdateWebSocketUrl(baseUrl));
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error('Alpaca trade_updates subscription timed out.'));
      }
    }, timeoutMs);
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      reject(new Error(message));
    };
    socket.addEventListener('open', () => socket.send(JSON.stringify(tradeUpdateAuthenticationMessage(auth))));
    socket.addEventListener('error', () => fail('Alpaca trade_updates socket failed.'));
    socket.addEventListener('close', () => fail('Alpaca trade_updates socket closed before subscription.'));
    socket.addEventListener('message', (event) => {
      void decodeSocketData(event.data).then(async (text) => {
        const message = JSON.parse(text) as Record<string, unknown>;
        if (message.stream === 'authorization') {
          const data = message.data as Record<string, unknown> | undefined;
          if (data?.status !== 'authorized') return fail('Alpaca trade_updates authentication was rejected.');
          socket.send(JSON.stringify(tradeUpdateListenMessage));
          return;
        }
        if (message.stream === 'listening') {
          const data = message.data as { streams?: unknown } | undefined;
          if (!Array.isArray(data?.streams) || !data.streams.includes('trade_updates')) return fail('Alpaca did not confirm the trade_updates stream.');
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve({ state: 'LISTENING', close: () => socket.close() });
          }
          return;
        }
        if (message.stream === 'trade_updates') await onUpdate(parseTradeUpdate(message));
      }).catch(() => fail('Alpaca trade_updates returned an invalid frame.'));
    });
  });
}
