import type { BrokerOrderSnapshot } from './broker.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';

export function brokerOrderIntentState(order: BrokerOrderSnapshot): OrderIntentState | null {
  const status = order.status.toLowerCase();
  if (order.filledQty >= order.qty && order.qty > 0) return 'FILLED';
  if (order.filledQty > 0) {
    // done_for_day / calculated are terminal for a DAY order: a part-filled order that is done is closed with its filled
    // quantity preserved, never left PARTIAL forever. The remainder is NOT resubmitted (Paper policy).
    return ['canceled', 'expired', 'rejected', 'replaced', 'done_for_day', 'calculated'].includes(status) ? 'CANCELED' : 'PARTIAL';
  }
  const byStatus: Readonly<Record<string, OrderIntentState>> = {
    accepted: 'ACKNOWLEDGED', new: 'ACKNOWLEDGED', pending_new: 'SUBMITTED',
    accepted_for_bidding: 'SUBMITTED', pending_replace: 'SUBMITTED',
    partially_filled: 'PARTIAL', fill: 'FILLED', filled: 'FILLED',
    pending_cancel: 'CANCEL_REQUESTED', canceled: 'CANCELED', replaced: 'CANCELED',
    expired: 'EXPIRED', done_for_day: 'EXPIRED', calculated: 'EXPIRED', rejected: 'REJECTED', stopped: 'REJECTED', suspended: 'REJECTED',
  };
  return byStatus[status] ?? null;
}
