/**
 * MULTI_LOT_DISPOSAL. Allocates ONE confirmed stock disposal (a sale fill or a call-away delivery) across the chain's open lots.
 *
 * Repository finding: no canonical lot-selection rule exists (no FIFO/LIFO/specific-lot/weighted/broker-lot policy in the TRD
 * text, schema, migrations or tests). So this allocator never invents one:
 *   - FULL POSITION: when the disposed quantity equals the chain's total open shares, every open lot is disposed in full. The
 *     allocation, each lot's realized P&L and the chain total are exact whatever order lots were chosen in, so no policy is
 *     needed. THETA's SELL_STOCK sells the full reconciled position, and a call-away that consumes every open share is the same.
 *   - PARTIAL position: which lots (and which part of a lot) are sold changes realized P&L. Without an explicit policy the
 *     result is UNKNOWN (OWNER_POLICY), never a guess. A policy may be injected (FIFO / LIFO) and the allocator then splits
 *     deterministically, flagging any partially consumed lot so the persistence layer can refuse what the schema cannot hold.
 *   - Unknown lot basis, non-integer / non-positive quantities, or more shares than are open: UNKNOWN. Nothing is coerced.
 * Invariants (property-tested): sum(allocated shares) = disposed shares; allocated <= lot shares; no negative remainder;
 * proceeds and cost basis are each allocated exactly once; chain realized P&L = sum of lot realized P&L.
 */

export interface OpenStockLot {
  readonly stockLotId: string;
  readonly shares: number;
  readonly economicBasisPerShare: number | null;
  readonly acquiredAt: string | null;
}

export type LotSelectionPolicy = 'FIFO' | 'LIFO';

export interface LotAllocation {
  readonly stockLotId: string;
  readonly shares: number;
  readonly lotShares: number;
  readonly remainingLotShares: number;
  readonly economicBasisPerShare: number;
  readonly proceeds: number;
  readonly costBasis: number;
  readonly realizedPnl: number;
}

export type StockDisposalUnknownReason =
  | 'DISPOSED_SHARES_INVALID'
  | 'DISPOSAL_PRICE_INVALID'
  | 'NO_OPEN_LOTS'
  | 'LOT_SHARES_INVALID'
  | 'DUPLICATE_LOT'
  | 'FILLED_EXCEEDS_OPEN_SHARES'
  | 'LOT_BASIS_UNKNOWN'
  | 'LOT_SELECTION_POLICY_REQUIRED'
  | 'PARTIAL_LOT_SPLIT_REQUIRED';

export type StockDisposalAllocation =
  | {
    readonly state: 'ALLOCATED'; readonly mode: 'FULL_POSITION' | 'POLICY_SELECTED';
    readonly allocations: readonly LotAllocation[]; readonly totalShares: number; readonly totalRealizedPnl: number;
    /** True when a lot is only partly consumed: the persistence layer must refuse it unless it can split lots. */
    readonly hasPartialLot: boolean;
  }
  | { readonly state: 'UNKNOWN'; readonly reason: StockDisposalUnknownReason; readonly allocations: null };

const unknown = (reason: StockDisposalUnknownReason): StockDisposalAllocation => ({ state: 'UNKNOWN', reason, allocations: null });
const wholeShares = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** Deterministic lot order: acquired time ascending, then lot id. A missing acquisition time sorts last, then by id. */
const orderLots = (lots: readonly OpenStockLot[]): readonly OpenStockLot[] => [...lots].sort((a, b) => {
  const left = a.acquiredAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.acquiredAt);
  const right = b.acquiredAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.acquiredAt);
  if (left !== right) return left < right ? -1 : 1;
  return a.stockLotId < b.stockLotId ? -1 : a.stockLotId > b.stockLotId ? 1 : 0;
});

export function allocateStockDisposal(input: {
  readonly lots: readonly OpenStockLot[];
  readonly disposedShares: number;
  readonly pricePerShare: number;
  readonly policy?: LotSelectionPolicy | null;
}): StockDisposalAllocation {
  if (!wholeShares(input.disposedShares)) return unknown('DISPOSED_SHARES_INVALID');
  if (!Number.isFinite(input.pricePerShare) || input.pricePerShare < 0) return unknown('DISPOSAL_PRICE_INVALID');
  if (input.lots.length === 0) return unknown('NO_OPEN_LOTS');
  if (new Set(input.lots.map((lot) => lot.stockLotId)).size !== input.lots.length) return unknown('DUPLICATE_LOT');
  if (input.lots.some((lot) => !wholeShares(lot.shares))) return unknown('LOT_SHARES_INVALID');
  const total = input.lots.reduce((sum, lot) => sum + lot.shares, 0);
  if (input.disposedShares > total) return unknown('FILLED_EXCEEDS_OPEN_SHARES');
  const ordered = orderLots(input.lots);
  const fullPosition = input.disposedShares === total;
  let sequence: readonly OpenStockLot[];
  if (fullPosition) sequence = ordered;
  else if (input.policy === 'FIFO') sequence = ordered;
  else if (input.policy === 'LIFO') sequence = [...ordered].reverse();
  else return unknown(input.lots.length === 1 ? 'PARTIAL_LOT_SPLIT_REQUIRED' : 'LOT_SELECTION_POLICY_REQUIRED');

  const allocations: LotAllocation[] = [];
  let remaining = input.disposedShares;
  for (const lot of sequence) {
    if (remaining === 0) break;
    if (lot.economicBasisPerShare === null || !Number.isFinite(lot.economicBasisPerShare)) return unknown('LOT_BASIS_UNKNOWN');
    const shares = Math.min(remaining, lot.shares);
    const proceeds = input.pricePerShare * shares, costBasis = lot.economicBasisPerShare * shares;
    allocations.push({ stockLotId: lot.stockLotId, shares, lotShares: lot.shares, remainingLotShares: lot.shares - shares,
      economicBasisPerShare: lot.economicBasisPerShare, proceeds, costBasis, realizedPnl: proceeds - costBasis });
    remaining -= shares;
  }
  if (remaining !== 0) return unknown('FILLED_EXCEEDS_OPEN_SHARES');
  return { state: 'ALLOCATED', mode: fullPosition ? 'FULL_POSITION' : 'POLICY_SELECTED', allocations,
    totalShares: input.disposedShares, totalRealizedPnl: allocations.reduce((sum, item) => sum + item.realizedPnl, 0),
    hasPartialLot: allocations.some((item) => item.remainingLotShares > 0) };
}
