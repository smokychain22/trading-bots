import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFillEventsForOrder } from '../src/research/alpaca-fill-event-adapter.js';
import type { BrokerActivity } from '../src/execution/broker.js';

function activity(overrides: Partial<BrokerActivity> & { id: string }): BrokerActivity {
  return { activityType: 'FILL', symbol: 'SPY251017P00590000', quantity: 1, price: 2.05, date: '2026-09-21T15:00:05Z', orderId: 'order-1', ...overrides };
}

test('CORE CLAIM: real fill activity rows are preserved individually, never collapsed to only an aggregate', () => {
  const result = aggregateFillEventsForOrder({
    orderId: 'order-1',
    activities: [
      activity({ id: 'evt-1', activityType: 'PARTIAL_FILL', quantity: 1, price: 2.00, date: '2026-09-21T15:00:01Z' }),
      activity({ id: 'evt-2', activityType: 'FILL', quantity: 2, price: 2.10, date: '2026-09-21T15:00:05Z' }),
    ],
  });
  assert.equal(result.perFillTimestampStatus, 'KNOWN');
  assert.equal(result.rawFillEvents.length, 2);
  assert.equal(result.firstFillAt, '2026-09-21T15:00:01Z');
  assert.equal(result.lastFillAt, '2026-09-21T15:00:05Z');
  assert.equal(result.totalFilledQty, 3);
  // weighted avg = (1*2.00 + 2*2.10) / 3 = 6.20/3
  assert.equal(result.weightedAverageFillPrice, 6.20 / 3);
});

test('ADVERSARIAL: no real fill activity rows means UNKNOWN with an exact reason, never a fabricated timestamp', () => {
  const result = aggregateFillEventsForOrder({ orderId: 'order-2', activities: [activity({ id: 'evt-1', orderId: 'order-1' })] });
  assert.equal(result.perFillTimestampStatus, 'UNKNOWN');
  assert.equal(result.firstFillAt, null);
  assert.ok(result.unknownReason?.includes('NO_FILL_ACTIVITY_ROWS_FOR_ORDER'));
});

test('non-fill activity types (e.g. cash movements) are never treated as fills', () => {
  const result = aggregateFillEventsForOrder({
    orderId: 'order-3',
    activities: [activity({ id: 'evt-1', orderId: 'order-3', activityType: 'CFEE' })],
  });
  assert.equal(result.rawFillEvents.length, 0);
  assert.equal(result.perFillTimestampStatus, 'UNKNOWN');
});

test('a malformed real row (null date/qty/price) is excluded, never coerced into a fake fill', () => {
  const result = aggregateFillEventsForOrder({
    orderId: 'order-4',
    activities: [
      activity({ id: 'evt-1', orderId: 'order-4', date: null }),
      activity({ id: 'evt-2', orderId: 'order-4', quantity: 2, price: 2.10, date: '2026-09-21T15:00:05Z' }),
    ],
  });
  assert.equal(result.rawFillEvents.length, 1);
  assert.equal(result.rawFillEvents[0]?.brokerEventId, 'evt-2');
});

test('activities for a different order are excluded from the aggregation', () => {
  const result = aggregateFillEventsForOrder({
    orderId: 'order-5',
    activities: [activity({ id: 'evt-1', orderId: 'order-OTHER' })],
  });
  assert.equal(result.rawFillEvents.length, 0);
});
