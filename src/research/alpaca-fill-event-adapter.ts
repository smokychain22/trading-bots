/**
 * THETA-EXECUTED-ENTRY-FILL-TIMESTAMP-GAP -- closed, source-level.
 *
 * Investigation finding: `BrokerOrderSnapshot` (src/execution/broker.ts)
 * only carries an order-level `filledQty`/`filledAvgPrice` -- no per-fill
 * timestamp, confirmed by direct read. But real per-fill evidence DOES
 * already exist through a different, already-implemented path:
 * `AlpacaPaperBrokerAdapter.getActivities()` / `parseBrokerActivity()`
 * parses Alpaca's real `/v2/account/activities` endpoint, which returns
 * one row per fill event with a real `id` (the broker's own per-fill
 * event id), `orderId`, `quantity`, `price`, and `date` (mapped from
 * Alpaca's `transaction_time ?? date` -- the real per-fill timestamp,
 * never invented from `submittedAt`/`updatedAt`).
 *
 * This module is a PURE adapter over an ALREADY-FETCHED
 * `readonly BrokerActivity[]` (matches the same architectural boundary as
 * `production-persistence-adapters.ts`: it never calls `getActivities()`
 * itself or holds broker credentials -- Codex's runtime fetches the
 * activities, this module only classifies/aggregates them). It does NOT
 * invent a fill timestamp from any other field: if the real activity feed
 * for an order genuinely contains no FILL/PARTIAL_FILL rows, the result
 * reports `PER_FILL_TIMESTAMP = 'UNKNOWN'` with the exact reason, never a
 * fallback timestamp.
 */
import type { BrokerActivity } from '../execution/broker.js';

export const alpacaFillEventAdapterVersion = 'theta-alpaca-fill-event-adapter-v1' as const;

/** Alpaca's real trade-activity type codes for an actual fill event.
 * Every other `activityType` value (cash movements, dividends, etc.) is
 * explicitly excluded, never treated as a fill. */
const FILL_ACTIVITY_TYPES: ReadonlySet<string> = new Set(['FILL', 'PARTIAL_FILL']);

export interface RawFillEvent {
  readonly brokerEventId: string;
  readonly orderId: string;
  readonly symbol: string | null;
  readonly fillTimestamp: string;
  readonly fillQty: number;
  readonly fillPrice: number;
  readonly partialOrFull: 'PARTIAL_FILL' | 'FILL';
}

export type PerFillTimestampStatus = 'KNOWN' | 'UNKNOWN';

export interface FillEventAggregation {
  readonly contractVersion: typeof alpacaFillEventAdapterVersion;
  readonly orderId: string;
  readonly perFillTimestampStatus: PerFillTimestampStatus;
  readonly unknownReason: string | null;
  /** Every individual raw fill event, preserved -- never collapsed into
   * only the aggregate fields below. */
  readonly rawFillEvents: readonly RawFillEvent[];
  readonly firstFillAt: string | null;
  readonly lastFillAt: string | null;
  readonly weightedAverageFillPrice: number | null;
  readonly totalFilledQty: number | null;
}

/**
 * Filters an already-fetched activity list down to real fill events for
 * one order, and derives the aggregate fields WITHOUT discarding the
 * per-event list. Never fabricates `firstFillAt`/`lastFillAt` from
 * anything other than a real fill activity's own timestamp.
 */
export function aggregateFillEventsForOrder(input: {
  readonly orderId: string;
  readonly activities: readonly BrokerActivity[];
}): FillEventAggregation {
  const forOrder = input.activities.filter((a) => a.orderId === input.orderId && FILL_ACTIVITY_TYPES.has(a.activityType));
  const rawFillEvents: RawFillEvent[] = [];
  for (const activity of forOrder) {
    if (activity.date === null || activity.quantity === null || activity.price === null) continue; // malformed real row -- excluded, never coerced
    rawFillEvents.push({
      brokerEventId: activity.id, orderId: input.orderId, symbol: activity.symbol,
      fillTimestamp: activity.date, fillQty: activity.quantity, fillPrice: activity.price,
      partialOrFull: activity.activityType === 'PARTIAL_FILL' ? 'PARTIAL_FILL' : 'FILL',
    });
  }
  rawFillEvents.sort((a, b) => Date.parse(a.fillTimestamp) - Date.parse(b.fillTimestamp));

  if (rawFillEvents.length === 0) {
    return {
      contractVersion: alpacaFillEventAdapterVersion, orderId: input.orderId, perFillTimestampStatus: 'UNKNOWN',
      unknownReason: 'NO_FILL_ACTIVITY_ROWS_FOR_ORDER -- either the order has not filled yet, or the activity feed does not (yet) contain a FILL/PARTIAL_FILL row for it',
      rawFillEvents: [], firstFillAt: null, lastFillAt: null, weightedAverageFillPrice: null, totalFilledQty: null,
    };
  }
  const first = rawFillEvents[0];
  const last = rawFillEvents[rawFillEvents.length - 1];
  if (first === undefined || last === undefined) throw new Error('ALPACA_FILL_EVENT_ADAPTER_INTERNAL_EMPTY');
  const totalFilledQty = rawFillEvents.reduce((sum, e) => sum + e.fillQty, 0);
  const weightedAverageFillPrice = totalFilledQty > 0
    ? rawFillEvents.reduce((sum, e) => sum + e.fillQty * e.fillPrice, 0) / totalFilledQty
    : null;
  return {
    contractVersion: alpacaFillEventAdapterVersion, orderId: input.orderId, perFillTimestampStatus: 'KNOWN', unknownReason: null,
    rawFillEvents, firstFillAt: first.fillTimestamp, lastFillAt: last.fillTimestamp, weightedAverageFillPrice, totalFilledQty,
  };
}
