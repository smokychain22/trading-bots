import { createHash } from 'node:crypto';

// Order intent state machine + idempotent client_order_id generation.
//
// The single most important invariant in this file: an ambiguous submission
// (network timeout, lost response, etc.) becomes UNKNOWN_SUBMISSION, and the
// ONLY valid transition out of UNKNOWN_SUBMISSION is RECONCILING -- there is
// no table entry back to SUBMITTING, so a caller cannot blindly resubmit an
// order whose broker-side existence hasn't been proven one way or the other.

export type OrderIntentState =
  | 'PROPOSED'
  | 'PREFLIGHT'
  | 'READY'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIAL'
  | 'FILLED'
  | 'CANCEL_REQUESTED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNKNOWN_SUBMISSION'
  | 'RECONCILING';

export const ORDER_INTENT_TRANSITIONS: Readonly<Record<OrderIntentState, readonly OrderIntentState[]>> = {
  PROPOSED: ['PREFLIGHT'],
  PREFLIGHT: ['READY', 'REJECTED'],
  READY: ['SUBMITTING'],
  SUBMITTING: ['SUBMITTED', 'UNKNOWN_SUBMISSION', 'REJECTED'],
  SUBMITTED: ['ACKNOWLEDGED', 'UNKNOWN_SUBMISSION'],
  ACKNOWLEDGED: ['PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'EXPIRED', 'REJECTED'],
  PARTIAL: ['FILLED', 'CANCEL_REQUESTED', 'EXPIRED'],
  CANCEL_REQUESTED: ['CANCELED', 'FILLED', 'PARTIAL', 'UNKNOWN_SUBMISSION'],
  CANCELED: [],
  FILLED: [],
  REJECTED: [],
  EXPIRED: [],
  // Deliberately does NOT include SUBMITTING -- reconciliation, never a
  // blind resubmit, is the only path out of an ambiguous submission.
  UNKNOWN_SUBMISSION: ['RECONCILING'],
  // Once broker truth is established, reconciliation resolves to whatever
  // state the broker actually proves the order is in -- including PROPOSED,
  // which permits a genuinely NEW order intent once this one is proven to
  // have never reached the broker at all.
  RECONCILING: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'PROPOSED'],
};

export class InvalidOrderIntentTransitionError extends Error {
  constructor(from: OrderIntentState, to: OrderIntentState) {
    super(`Invalid order-intent transition: ${from} -> ${to}. UNKNOWN_SUBMISSION must reconcile before any resubmission.`);
    this.name = 'InvalidOrderIntentTransitionError';
  }
}

export function isValidOrderIntentTransition(from: OrderIntentState, to: OrderIntentState): boolean {
  return ORDER_INTENT_TRANSITIONS[from].includes(to);
}

export function assertValidOrderIntentTransition(from: OrderIntentState, to: OrderIntentState): void {
  if (!isValidOrderIntentTransition(from, to)) {
    throw new InvalidOrderIntentTransitionError(from, to);
  }
}

export interface OrderIntentTransitionRecord {
  readonly orderIntentId: string;
  readonly from: OrderIntentState;
  readonly to: OrderIntentState;
  readonly timestamp: string;
}

export function applyOrderIntentTransition(
  orderIntentId: string,
  from: OrderIntentState,
  to: OrderIntentState,
  timestamp: string,
): OrderIntentTransitionRecord {
  assertValidOrderIntentTransition(from, to);
  return { orderIntentId, from, to, timestamp };
}

/**
 * Deterministic, idempotent client_order_id: the SAME (decisionId,
 * candidateId, attempt) always produces the SAME id, so a resubmission
 * after reconciliation proves "this exact intent" rather than minting a
 * fresh, unrelated broker order. Attempt is a required argument -- a caller
 * must explicitly increment it (after RECONCILING proves the prior attempt
 * never reached the broker) rather than this function silently allowing
 * unlimited identical retries.
 */
export function generateClientOrderId(decisionId: string, candidateId: string, attempt: number): string {
  if (attempt < 1 || !Number.isInteger(attempt)) {
    throw new Error('attempt must be a positive integer');
  }
  const hash = createHash('sha256')
    .update(`${decisionId}:${candidateId}:${attempt}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `theta-${hash}`;
}
