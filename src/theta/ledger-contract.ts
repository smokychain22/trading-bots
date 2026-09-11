import { z } from 'zod';

// TS-side contract mirroring migrations/004_economic_lifecycle_ledger.sql.
// These types describe the shape a durable store (PostgreSQL, per that
// migration) persists -- this file adds no persistence itself, only
// validation and the WholeChainPnL computation, which is a pure function
// over already-recorded ledger rows (never invented, never re-derives a
// realized_pnl the ledger itself already fixed immutably).

export const ledgerContractVersion = 'theta-ledger-runtime-v2' as const;

export const orderIntentStatus = z.enum([
  'PROPOSED', 'PREFLIGHT', 'READY', 'SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED',
  'PARTIAL', 'FILLED', 'CANCEL_REQUESTED', 'CANCELED', 'REJECTED', 'EXPIRED',
  'UNKNOWN_SUBMISSION', 'RECONCILING',
]);

export const lifecycleState = z.enum([
  'WAIT', 'CSP_PROPOSED', 'CSP_OPEN', 'BTC_CLOSE', 'EXPIRE_OTM', 'ROLL_DECISION',
  'ASSIGNED', 'STOCK_HELD', 'RECOVERY_WAIT', 'CC_PROPOSED', 'CC_OPEN', 'CLOSE_CC',
  'CALL_AWAY', 'CLOSE_STOCK', 'REDEPLOY', 'CLOSED',
]);

export const reconciliationState = z.enum([
  'MATCHED', 'PENDING', 'PARTIAL_FILL', 'UNKNOWN_SUBMISSION', 'BROKER_ONLY_ORDER',
  'LOCAL_ONLY_INTENT', 'POSITION_MISMATCH', 'FILL_MISMATCH', 'ASSIGNMENT_DETECTED',
  'EXPIRY_DETECTED', 'CORPORATE_ACTION_REVIEW', 'RECONCILIATION_REQUIRED', 'QUARANTINED',
]);

export const optionLegSchema = z.object({
  optionLegId: z.string().min(1),
  chainId: z.string().min(1),
  side: z.enum(['SHORT', 'LONG']),
  quantity: z.number().nonnegative(),
  entryCreditDebit: z.number().finite().nullable(),
  openedAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }).nullable(),
  closeReason: z.enum(['BTC_CLOSE', 'EXPIRE_OTM', 'ROLLED', 'ASSIGNED', 'EXERCISED']).nullable(),
  realizedPnl: z.number().finite().nullable(),
  rolledFromOptionLegId: z.string().min(1).nullable(),
  rolledToOptionLegId: z.string().min(1).nullable(),
}).superRefine((leg, context) => {
  if (leg.closedAt !== null && (leg.closeReason === null || leg.realizedPnl === null)) {
    context.addIssue({ code: 'custom', message: 'a closed option leg must carry both closeReason and realizedPnl' });
  }
  if (leg.closedAt === null && leg.realizedPnl !== null) {
    context.addIssue({ code: 'custom', message: 'an open option leg must not carry a realizedPnl' });
  }
});

export const stockLotSchema = z.object({
  stockLotId: z.string().min(1),
  chainId: z.string().min(1),
  shares: z.number().nonnegative(),
  economicBasisPerShare: z.number().finite(),
  brokerBasisPerShare: z.number().finite().nullable(),
  assignmentOptionLegId: z.string().min(1).nullable(),
  acquiredAt: z.string().datetime({ offset: true }),
  disposedAt: z.string().datetime({ offset: true }).nullable(),
  disposedPricePerShare: z.number().finite().nullable(),
  realizedPnl: z.number().finite().nullable(),
  currentPricePerShare: z.number().finite().nullable(), // for open-lot unrealized MTM -- never omitted to "hide" a loss
}).superRefine((lot, context) => {
  if (lot.disposedAt !== null && lot.realizedPnl === null) {
    context.addIssue({ code: 'custom', message: 'a disposed stock lot must carry a realizedPnl -- assignment/disposal is never an automatic win with no accounting' });
  }
  if (lot.disposedAt === null && lot.realizedPnl !== null) {
    context.addIssue({ code: 'custom', message: 'an open stock lot must not carry a realizedPnl -- unrealized MTM belongs in currentPricePerShare instead' });
  }
});

export const dividendEventSchema = z.object({
  stockLotId: z.string().min(1),
  exDate: z.string().date(),
  amountPerShare: z.number().finite().nonnegative(),
});

export const feeEventSchema = z.object({
  chainId: z.string().min(1),
  feeType: z.string().min(1),
  amount: z.number().finite().nonnegative(),
  incurredAt: z.string().datetime({ offset: true }),
});

export type OptionLeg = z.infer<typeof optionLegSchema>;
export type StockLot = z.infer<typeof stockLotSchema>;
export type DividendEvent = z.infer<typeof dividendEventSchema>;
export type FeeEvent = z.infer<typeof feeEventSchema>;

export interface WholeChainPnlBreakdown {
  readonly realizedOptionPnl: number;
  readonly unrealizedOptionPnl: number | null;
  readonly realizedStockPnl: number;
  readonly unrealizedStockPnl: number | null;
  readonly dividends: number | null;
  readonly fees: number;
  readonly wholeChainPnl: number | null;
  readonly valuationIssues: readonly ('OPEN_OPTION_MARK_UNAVAILABLE' | 'STOCK_MARK_UNAVAILABLE' | 'DIVIDEND_LOT_UNAVAILABLE')[];
  readonly hasUnresolvedOpenPositions: boolean;
}

/**
 * WholeChainPnl = RealizedStockPnl + UnrealizedStockPnl + RealizedOptionPnl
 * + UnrealizedOptionPnl + Dividends - Fees - Slippage, per
 * docs/quant/phase2/FORMULA_REGISTRY.md. Slippage is folded into fees here
 * (this ledger's `fee_event` rows are the only cost line item recorded;
 * a future execution-quality integration may split slippage out
 * separately -- not done here to avoid inventing a field the ledger schema
 * doesn't yet have a home for).
 *
 * An open option leg's unrealized value is NOT computed by this function
 * (unlike stock, this ledger's option_leg table has no current-mark field
 * -- until a provenance-aware option valuation is supplied, its component
 * and the total are null). Open inventory and missing valuation are
 * distinct states: a marked stock lot can have a known unrealized loss.
 * Known realized components remain visible even when the total is unknown.
 */
export function computeWholeChainPnl(
  legs: readonly OptionLeg[],
  lots: readonly StockLot[],
  dividends: readonly DividendEvent[],
  fees: readonly FeeEvent[],
): WholeChainPnlBreakdown {
  const realizedOptionPnl = legs.reduce((sum, leg) => sum + (leg.realizedPnl ?? 0), 0);
  const realizedStockPnl = lots.reduce((sum, lot) => sum + (lot.realizedPnl ?? 0), 0);

  const valuationIssues: WholeChainPnlBreakdown['valuationIssues'][number][] = [];
  const unrealizedOptionPnl = legs.some((leg) => leg.closedAt === null && leg.quantity > 0) ? null : 0;
  if (unrealizedOptionPnl === null) valuationIssues.push('OPEN_OPTION_MARK_UNAVAILABLE');
  const missingStockMark = lots.some((lot) => lot.disposedAt === null && lot.shares > 0 && lot.currentPricePerShare === null);
  if (missingStockMark) valuationIssues.push('STOCK_MARK_UNAVAILABLE');
  const unrealizedStockPnl = missingStockMark ? null : lots
    .filter((lot) => lot.disposedAt === null)
    .reduce((sum, lot) => {
      if (lot.shares === 0) return sum;
      // A nonzero open lot with a missing mark was handled above.
      if (lot.currentPricePerShare === null) return sum;
      return sum + (lot.currentPricePerShare - lot.economicBasisPerShare) * lot.shares;
    }, 0);

  // Dividends are per-share -- must be scaled by the paying lot's share
  // count, never summed as if amountPerShare were already a total. A
  // dividend event referencing an unknown lot makes the aggregate unknown.
  const lotsById = new Map(lots.map((lot) => [lot.stockLotId, lot]));
  const missingDividendLot = dividends.some((dividend) => !lotsById.has(dividend.stockLotId));
  if (missingDividendLot) valuationIssues.push('DIVIDEND_LOT_UNAVAILABLE');
  const dividendTotal = missingDividendLot ? null : dividends.reduce((sum, d) => {
    const lot = lotsById.get(d.stockLotId);
    if (lot === undefined) return sum;
    return sum + d.amountPerShare * lot.shares;
  }, 0);

  const feeTotal = fees.reduce((sum, f) => sum + f.amount, 0);

  const hasUnresolvedOpenPositions =
    legs.some((leg) => leg.closedAt === null) || lots.some((lot) => lot.disposedAt === null);

  const wholeChainPnl = unrealizedStockPnl === null || unrealizedOptionPnl === null || dividendTotal === null
    ? null
    : realizedStockPnl + unrealizedStockPnl + realizedOptionPnl + unrealizedOptionPnl + dividendTotal - feeTotal;

  return {
    realizedOptionPnl,
    unrealizedOptionPnl,
    realizedStockPnl,
    unrealizedStockPnl,
    dividends: dividendTotal,
    fees: feeTotal,
    wholeChainPnl,
    valuationIssues,
    hasUnresolvedOpenPositions,
  };
}
