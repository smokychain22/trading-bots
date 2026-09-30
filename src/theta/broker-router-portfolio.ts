import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot } from './alpaca-provider.js';
import { parseOccOptionSymbol } from './account-exposure.js';

/** Entry applicability only. Chain-level management retains its own reconciled
 * lifecycle authority. Broker positions cannot prove assignment imminence. */
export function deriveBrokerRouterPortfolio(input: {
  underlying: string;
  positions: readonly AlpacaPositionSnapshot[];
  orders: readonly AlpacaOpenOrderSnapshot[];
  positionsReady: boolean;
  ordersReady: boolean;
  accountReady: boolean;
  observedAt: string;
}) {
  const unknown = (reason: string) => ({
    portfolio: { lifecycleState: 'UNKNOWN', stockSharesHeld: null,
      openOptionExists: null, assignmentImminent: null },
    origin: 'REAL_PROVIDER_UNKNOWN' as const, reason, observedAt: input.observedAt,
    version: 'broker-router-portfolio-v1',
  });
  if (!input.accountReady || !input.positionsReady || !input.ordersReady)
    return unknown('BROKER_PORTFOLIO_EVIDENCE_UNAVAILABLE');
  // Unclassifiable identity anywhere in the account cannot prove absence of
  // exposure in this symbol. Never treat a failed parse as another symbol.
  if (input.positions.some(p => p.quantity === null || !Number.isFinite(p.quantity)
    || !['us_equity', 'us_option'].includes(p.assetClass ?? '')
    || (p.assetClass === 'us_option' && parseOccOptionSymbol(p.symbol) === null)))
    return unknown('BROKER_POSITION_UNCLASSIFIED');
  if (input.orders.some(o => o.symbol === null)) return unknown('BROKER_ORDER_IDENTITY_UNKNOWN');
  const positions = input.positions.filter(p => p.quantity !== 0 &&
    (p.symbol === input.underlying || parseOccOptionSymbol(p.symbol)?.underlying === input.underlying));
  const stocks = positions.filter(p => p.assetClass === 'us_equity');
  const options = positions.filter(p => p.assetClass === 'us_option');
  if (stocks.some(p => p.side !== 'long' || (p.quantity ?? -1) < 0))
    return unknown('SHORT_STOCK_REQUIRES_MANAGEMENT_LIFECYCLE');
  const shares = stocks.reduce((n, p) => n + (p.quantity as number), 0);
  const pending = input.orders.some(o => o.symbol === input.underlying
    || parseOccOptionSymbol(o.symbol as string)?.underlying === input.underlying);
  const shortPuts = options.length > 0 && options.every(p => p.side === 'short'
    && parseOccOptionSymbol(p.symbol)?.optionType === 'PUT');
  // Deliverable coverage cannot be proved from position symbol/quantity alone.
  // Keep mixed/covered option lifecycle in the canonical management path.
  if (options.length > 0 && !shortPuts) return unknown('CANONICAL_OPTION_LIFECYCLE_REQUIRED');
  return {
    portfolio: { lifecycleState: pending ? 'ORDER_PENDING' : shortPuts ? 'CSP_OPEN'
      : shares > 0 ? 'STOCK_HELD' : 'CASH_AVAILABLE',
    stockSharesHeld: shares, openOptionExists: options.length > 0,
    assignmentImminent: options.length === 0 ? false : null },
    origin: options.length === 0 ? 'DERIVED_FROM_REAL' as const : 'REAL_PROVIDER_UNKNOWN' as const,
    reason: options.length === 0 ? 'BROKER_POSITION_AND_ORDER_READ_COMPLETE' : 'ASSIGNMENT_IMMINENCE_REQUIRES_MANAGEMENT_EVIDENCE',
    observedAt: input.observedAt, version: 'broker-router-portfolio-v1',
  };
}
