// THETA lifecycle state machine. Mirrors the canonical lifecycle
// (TRD v1.1 FINAL section 4, CLAUDE.md's "What THETA is"):
//
//   WAIT -> CSP_PROPOSED -> CSP_OPEN
//     -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> NEW_CSP
//     -> ASSIGNED -> STOCK_HELD
//          -> RECOVERY_WAIT -> SELL_STOCK
//          -> CC_PROPOSED -> CC_OPEN
//               -> BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION -> CALLED_AWAY
//     -> CASH / REDEPLOY
//
// Every transition is an explicit, tested table entry -- no transition is
// invented merely to make an implementation convenient (per this takeover's
// R1A instruction). One instance of this state machine tracks ONE economic
// chain (a chain_id); a new chain gets a fresh WAIT instance.

export type ThetaLifecycleState =
  | 'WAIT'
  | 'CSP_PROPOSED'
  | 'CSP_OPEN'
  | 'BTC_CLOSE'
  | 'EXPIRE_OTM'
  | 'ROLL_DECISION'
  | 'ASSIGNED'
  | 'STOCK_HELD'
  | 'RECOVERY_WAIT'
  | 'CC_PROPOSED'
  | 'CC_OPEN'
  | 'CLOSE_CC'
  | 'CALL_AWAY'
  | 'CLOSE_STOCK'
  | 'REDEPLOY'
  | 'CLOSED';

// The transition table. Each entry lists every state reachable from the key
// in exactly one lifecycle step. CLOSED is terminal for this chain instance.
export const THETA_LIFECYCLE_TRANSITIONS: Readonly<Record<ThetaLifecycleState, readonly ThetaLifecycleState[]>> = {
  WAIT: ['CSP_PROPOSED'],
  CSP_PROPOSED: ['CSP_OPEN', 'WAIT'], // WAIT: proposal rejected/expired before fill
  CSP_OPEN: ['BTC_CLOSE', 'EXPIRE_OTM', 'ROLL_DECISION', 'ASSIGNED'],
  BTC_CLOSE: ['REDEPLOY'],
  // A put expiry releases cash and can redeploy. A covered-call expiry
  // returns the still-owned stock to recovery evaluation. The reconciler
  // supplies the leg context and broker evidence before choosing either.
  EXPIRE_OTM: ['REDEPLOY', 'RECOVERY_WAIT'],
  ROLL_DECISION: ['CSP_PROPOSED', 'ASSIGNED'], // roll opens a new CSP proposal, or assignment is accepted instead
  ASSIGNED: ['STOCK_HELD'],
  STOCK_HELD: ['RECOVERY_WAIT'],
  RECOVERY_WAIT: ['CLOSE_STOCK', 'CC_PROPOSED'],
  CC_PROPOSED: ['CC_OPEN', 'RECOVERY_WAIT'], // CC proposal rejected -- back to waiting
  CC_OPEN: ['CLOSE_CC', 'EXPIRE_OTM', 'ROLL_DECISION', 'CALL_AWAY'],
  CLOSE_CC: ['CLOSE_STOCK', 'REDEPLOY'], // stock may still be held (sell later) or was already exited
  CALL_AWAY: ['CLOSED'], // shares are gone; chain resolves
  CLOSE_STOCK: ['CLOSED'],
  REDEPLOY: ['WAIT'], // freed capital re-enters evaluation as a fresh candidate search
  CLOSED: [],
};

export class InvalidLifecycleTransitionError extends Error {
  constructor(from: ThetaLifecycleState, to: ThetaLifecycleState) {
    super(`Invalid THETA lifecycle transition: ${from} -> ${to}`);
    this.name = 'InvalidLifecycleTransitionError';
  }
}

export function isValidLifecycleTransition(from: ThetaLifecycleState, to: ThetaLifecycleState): boolean {
  return THETA_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function assertValidLifecycleTransition(from: ThetaLifecycleState, to: ThetaLifecycleState): void {
  if (!isValidLifecycleTransition(from, to)) {
    throw new InvalidLifecycleTransitionError(from, to);
  }
}

export interface LifecycleTransitionRecord {
  readonly chainId: string;
  readonly from: ThetaLifecycleState;
  readonly to: ThetaLifecycleState;
  readonly timestamp: string;
  readonly decisionId: string;
}

/**
 * Applies a validated transition and returns the immutable record of it.
 * Throws on an invalid transition rather than silently coercing the state --
 * an invalid transition is a bug to surface, never to route around.
 */
export function applyLifecycleTransition(
  chainId: string,
  from: ThetaLifecycleState,
  to: ThetaLifecycleState,
  decisionId: string,
  timestamp: string,
): LifecycleTransitionRecord {
  assertValidLifecycleTransition(from, to);
  return { chainId, from, to, timestamp, decisionId };
}
