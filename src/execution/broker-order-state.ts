import type { BrokerOrderSnapshot } from './broker.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';

export function brokerOrderIntentState(order: BrokerOrderSnapshot): OrderIntentState | null {
  const status = order.status.toLowerCase();
  if (order.filledQty >= order.qty && order.qty > 0) return 'FILLED';
  if (order.filledQty > 0) {
    return ['canceled', 'expired', 'rejected', 'replaced'].includes(status) ? 'CANCELED' : 'PARTIAL';
  }
  const byStatus: Readonly<Record<string, OrderIntentState>> = {
    accepted: 'ACKNOWLEDGED', new: 'ACKNOWLEDGED', pending_new: 'SUBMITTED',
    accepted_for_bidding: 'SUBMITTED', pending_replace: 'SUBMITTED',
    partially_filled: 'PARTIAL', fill: 'FILLED', filled: 'FILLED',
    pending_cancel: 'CANCEL_REQUESTED', canceled: 'CANCELED', replaced: 'CANCELED',
    expired: 'EXPIRED', rejected: 'REJECTED', stopped: 'REJECTED', suspended: 'REJECTED',
  };
  return byStatus[status] ?? null;
}
