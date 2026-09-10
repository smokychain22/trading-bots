import assert from 'node:assert/strict';
import test from 'node:test';
import { AssignmentRegistry, detectAssignment } from '../src/execution/lifecycle-reconciliation.js';
import { TradeUpdateReconciler, connectTradeUpdates, parseTradeUpdate, tradeUpdateWebSocketUrl, type TradeUpdateSocket } from '../src/execution/trade-updates.js';

const update = (overrides: Record<string, unknown> = {}) => ({
  stream: 'trade_updates', data: {
    event_id: 'event-1', event: 'partial_fill', execution_id: 'fill-1', timestamp: '2026-09-11T14:30:00Z', qty: '1', price: '1.24',
    order: { id: 'broker-1', client_order_id: 'theta-1', status: 'partially_filled', filled_qty: '1', filled_avg_price: '1.24' }, ...overrides,
  },
});

test('trade_updates maps partial and terminal states and deduplicates economic fills', () => {
  assert.equal(parseTradeUpdate(update()).orderState, 'PARTIAL');
  const reconciler = new TradeUpdateReconciler();
  assert.deepEqual(reconciler.apply(update()), { duplicate: false, state: 'PARTIAL', fillRecorded: true });
  assert.deepEqual(reconciler.apply(update()), { duplicate: true, state: 'PARTIAL', fillRecorded: false });
  assert.deepEqual(reconciler.apply(update({ event_id: 'event-2', event: 'fill', execution_id: 'fill-2', order: { id: 'broker-1', client_order_id: 'theta-1', status: 'filled', filled_qty: '2' } })), { duplicate: false, state: 'FILLED', fillRecorded: true });
  assert.equal(reconciler.updates.length, 2);
});

test('trade update stream is permanently locked to the PAPER websocket', () => {
  assert.equal(tradeUpdateWebSocketUrl('https://paper-api.alpaca.markets'), 'wss://paper-api.alpaca.markets/stream');
  assert.throws(() => tradeUpdateWebSocketUrl('https://api.alpaca.markets'), /PAPER/);
});

test('trade_updates authenticates, subscribes, and consumes binary-compatible frames', async () => {
  class FakeSocket implements TradeUpdateSocket {
    readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    readonly sent: string[] = [];
    closed = false;
    send(data: string) { this.sent.push(data); }
    close() { this.closed = true; }
    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
  }
  const socket = new FakeSocket();
  const received: string[] = [];
  const sessionPromise = connectTradeUpdates(
    'https://paper-api.alpaca.markets',
    { kind: 'FOLLOWER_OAUTH', accessToken: 'test-private-token' },
    async (item) => { received.push(item.eventId); },
    () => socket,
  );
  socket.emit('open');
  assert.equal(JSON.parse(socket.sent[0] ?? '{}').key, 'oauth');
  socket.emit('message', JSON.stringify({ stream: 'authorization', data: { status: 'authorized' } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(socket.sent[1] ?? '{}').data.streams, ['trade_updates']);
  socket.emit('message', JSON.stringify({ stream: 'listening', data: { streams: ['trade_updates'] } }));
  const session = await sessionPromise;
  socket.emit('message', new TextEncoder().encode(JSON.stringify(update())).buffer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, ['event-1']);
  session.close();
  assert.equal(socket.closed, true);
});

test('provisional assignment upgrades in place when delayed OPASN arrives', () => {
  const input = { executionAccountId: 'account-1', chainId: 'chain-1', optionSymbol: 'AAPL261016P00150000', underlyingSymbol: 'AAPL', contracts: 1, multiplier: 100, occurrenceDate: '2026-10-16' };
  const previous = [{ symbol: input.optionSymbol, quantity: -1 }, { symbol: 'AAPL', quantity: 0 }];
  const current = [{ symbol: 'AAPL', quantity: 100 }];
  const provisional = detectAssignment(input, previous, current, []);
  assert.equal(provisional?.state, 'PROVISIONAL');
  const confirmed = detectAssignment(input, previous, current, [{ id: 'opasn-1', activityType: 'OPASN', symbol: input.optionSymbol, quantity: 1, price: null, date: '2026-10-16', orderId: null }]);
  assert.equal(confirmed?.state, 'CONFIRMED');
  assert.equal(confirmed?.reconciliationKey, provisional?.reconciliationKey);
  assert.ok(provisional !== null);
  assert.ok(confirmed !== null);
  const registry = new AssignmentRegistry(); registry.upsert(provisional); registry.upsert(confirmed);
  assert.equal(registry.size, 1);
});
