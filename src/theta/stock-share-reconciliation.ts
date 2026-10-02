/**
 * Two share truths. LEDGER_SHARES is what the THETA chain ledger says the chain owns; BROKER_SHARES is what Alpaca's
 * reconciled position snapshot says the account holds. A stock disposal may only be built from shares that BOTH agree on.
 * This module never invents a cause: when the two disagree the state is a typed MISMATCH whose candidate causes are hints,
 * and when evidence is missing the state is UNKNOWN. Nothing here coerces UNKNOWN to zero.
 */

export type BrokerStockInventoryState = 'KNOWN' | 'UNKNOWN';

export interface BrokerStockInventoryEvidence {
  readonly state: BrokerStockInventoryState;
  /** Signed whole-share quantity from the broker snapshot (long positive, short negative). null when UNKNOWN. */
  readonly quantity: number | null;
  /** ISO time the broker position snapshot was observed. null when UNKNOWN. */
  readonly observedAt: string | null;
  readonly reason: 'BROKER_POSITION_UNAVAILABLE' | 'BROKER_POSITION_SIDE_UNKNOWN' | 'BROKER_POSITION_QUANTITY_INVALID' | null;
}

export type StockShareReconciliationReason =
  | 'RECONCILED'
  | 'RECONCILIATION_NOT_GOOD'
  | 'BROKER_UNAVAILABLE'
  | 'BROKER_EVIDENCE_STALE'
  | 'BROKER_EVIDENCE_FROM_FUTURE'
  | 'BROKER_SHORT_STOCK_POSITION'
  | 'LEDGER_SHARES_INVALID'
  | 'BROKER_SHARES_NOT_WHOLE'
  | 'LEDGER_AHEAD_OF_BROKER'
  | 'BROKER_AHEAD_OF_LEDGER';

export type StockShareCandidateCause =
  | 'LATE_FILL_NOT_YET_REFLECTED_AT_BROKER'
  | 'PARTIAL_DISPOSAL_NOT_YET_REFLECTED_IN_LEDGER'
  | 'ASSIGNMENT_NOT_YET_REFLECTED_IN_LEDGER'
  | 'LEDGER_PERSISTENCE_LAG'
  | 'EXTERNAL_OR_MANUAL_ACTIVITY'
  | 'CORPORATE_ACTION';

/** Recovery class for every non-RECONCILED reason: no permanent silent stall. */
export type StockShareBlockClass = 'TRANSIENT_RETRYABLE' | 'REQUIRES_RECONCILIATION' | 'REQUIRES_NEW_DECISION' | 'OWNER_POLICY' | 'TERMINAL';

export const stockShareBlockClass: Readonly<Record<Exclude<StockShareReconciliationReason, 'RECONCILED'>, StockShareBlockClass>> = Object.freeze({
  RECONCILIATION_NOT_GOOD: 'TRANSIENT_RETRYABLE',
  BROKER_UNAVAILABLE: 'TRANSIENT_RETRYABLE',
  BROKER_EVIDENCE_STALE: 'TRANSIENT_RETRYABLE',
  BROKER_EVIDENCE_FROM_FUTURE: 'REQUIRES_NEW_DECISION',
  BROKER_SHORT_STOCK_POSITION: 'REQUIRES_RECONCILIATION',
  LEDGER_SHARES_INVALID: 'REQUIRES_RECONCILIATION',
  BROKER_SHARES_NOT_WHOLE: 'REQUIRES_RECONCILIATION',
  LEDGER_AHEAD_OF_BROKER: 'REQUIRES_RECONCILIATION',
  BROKER_AHEAD_OF_LEDGER: 'REQUIRES_RECONCILIATION',
});

export interface StockShareReconciliation {
  readonly state: 'RECONCILED' | 'MISMATCH' | 'UNKNOWN';
  readonly reason: StockShareReconciliationReason;
  readonly ledgerShares: number | null;
  readonly brokerShares: number | null;
  /** Shares both truths agree on (min of the two) only when RECONCILED, else null. */
  readonly reconciledShares: number | null;
  /** Hints only. Never asserted as the cause. */
  readonly candidateCauses: readonly StockShareCandidateCause[];
  readonly blockClass: StockShareBlockClass | null;
}

export const stockSharesReconciliationMaxAgeMs = 180_000;

const wholePositive = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value > 0;

export function reconcileStockShares(input: {
  readonly ledgerShares: number | null;
  readonly broker: BrokerStockInventoryEvidence | null | undefined;
  readonly reconciliationQuality: string | null;
  readonly now: string;
  readonly maxAgeMs?: number;
}): StockShareReconciliation {
  const ledger = input.ledgerShares;
  const result = (state: StockShareReconciliation['state'], reason: StockShareReconciliationReason, brokerShares: number | null,
    candidateCauses: readonly StockShareCandidateCause[] = []): StockShareReconciliation => ({
    state, reason, ledgerShares: ledger, brokerShares, reconciledShares: state === 'RECONCILED' ? ledger : null, candidateCauses,
    blockClass: reason === 'RECONCILED' ? null : stockShareBlockClass[reason],
  });
  if (input.reconciliationQuality !== 'GOOD') return result('UNKNOWN', 'RECONCILIATION_NOT_GOOD', null);
  const broker = input.broker;
  if (broker === null || broker === undefined || broker.state !== 'KNOWN' || broker.quantity === null || broker.observedAt === null) {
    return result('UNKNOWN', 'BROKER_UNAVAILABLE', null);
  }
  const observed = Date.parse(broker.observedAt), now = Date.parse(input.now);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return result('UNKNOWN', 'BROKER_UNAVAILABLE', null);
  if (observed > now) return result('UNKNOWN', 'BROKER_EVIDENCE_FROM_FUTURE', broker.quantity);
  if (now - observed > (input.maxAgeMs ?? stockSharesReconciliationMaxAgeMs)) return result('UNKNOWN', 'BROKER_EVIDENCE_STALE', broker.quantity);
  if (!Number.isSafeInteger(broker.quantity)) return result('MISMATCH', 'BROKER_SHARES_NOT_WHOLE', broker.quantity);
  if (broker.quantity < 0) return result('MISMATCH', 'BROKER_SHORT_STOCK_POSITION', broker.quantity);
  if (ledger === null || !Number.isSafeInteger(ledger) || ledger < 0) return result('UNKNOWN', 'LEDGER_SHARES_INVALID', broker.quantity);
  if (ledger === broker.quantity) return wholePositive(ledger) || ledger === 0
    ? result('RECONCILED', 'RECONCILED', broker.quantity) : result('UNKNOWN', 'LEDGER_SHARES_INVALID', broker.quantity);
  return ledger > broker.quantity
    ? result('MISMATCH', 'LEDGER_AHEAD_OF_BROKER', broker.quantity, ['LATE_FILL_NOT_YET_REFLECTED_AT_BROKER',
      'PARTIAL_DISPOSAL_NOT_YET_REFLECTED_IN_LEDGER', 'EXTERNAL_OR_MANUAL_ACTIVITY', 'CORPORATE_ACTION'])
    : result('MISMATCH', 'BROKER_AHEAD_OF_LEDGER', broker.quantity, ['ASSIGNMENT_NOT_YET_REFLECTED_IN_LEDGER',
      'LEDGER_PERSISTENCE_LAG', 'EXTERNAL_OR_MANUAL_ACTIVITY', 'CORPORATE_ACTION']);
}

export interface FreeSellableShares {
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly freeShares: number | null;
  readonly committedShares: number | null;
  readonly reason: 'SHARES_NOT_RECONCILED' | 'COMMITTED_SHORT_CALLS_UNKNOWN' | 'MULTIPLIER_INVALID' | 'OVERCOMMITTED_INVALID_STATE' | null;
}

/**
 * FREE_SELLABLE_SHARES = max(0, reconciledShares - multiplier * committedShortCallContracts).
 * `committedShortCallContracts` counts short call positions, working sell-to-open orders and published/claimed/waiting plans.
 * UNKNOWN reconciled shares or UNKNOWN commitments are UNKNOWN (never zero by coercion). A commitment that needs more shares
 * than are held (e.g. 99 shares + 1 call) is an invalid, possibly naked state and fails closed as UNKNOWN, never a quiet zero.
 */
export function freeSellableShares(reconciledShares: number | null, committedShortCallContracts: number | null | undefined,
  multiplier = 100): FreeSellableShares {
  const unknown = (reason: NonNullable<FreeSellableShares['reason']>, committed: number | null = null): FreeSellableShares =>
    ({ state: 'UNKNOWN', freeShares: null, committedShares: committed, reason });
  if (reconciledShares === null || !Number.isSafeInteger(reconciledShares) || reconciledShares < 0) return unknown('SHARES_NOT_RECONCILED');
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) return unknown('MULTIPLIER_INVALID');
  if (committedShortCallContracts === null || committedShortCallContracts === undefined || !Number.isSafeInteger(committedShortCallContracts)
    || committedShortCallContracts < 0) return unknown('COMMITTED_SHORT_CALLS_UNKNOWN');
  const committedShares = committedShortCallContracts * multiplier;
  if (committedShares > reconciledShares) return unknown('OVERCOMMITTED_INVALID_STATE', committedShares);
  return { state: 'KNOWN', freeShares: reconciledShares - committedShares, committedShares, reason: null };
}
