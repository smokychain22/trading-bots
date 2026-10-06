import type { Pool } from 'pg';
import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { fetchLatestStockQuote, fetchOptionSnapshots } from '../theta/alpaca-provider.js';
import { withRuntimePostgresReadRetry } from '../theta/runtime-postgres-client.js';
import type { PaperOrderCoordinator, PaperOrderStore } from './paper-order-coordinator.js';
import { PostgresDefinedRiskPositionStore, type DefinedRiskPositionSnapshot } from './postgres-defined-risk-position-store.js';
import { PostgresDefinedRiskDecisionRecorder } from './postgres-defined-risk-decision-recorder.js';
import { runDefinedRiskManagementScan, type DefinedRiskScanInputs, type DefinedRiskScanResult } from './defined-risk-management-runner.js';

/** named, not inline: the pre-submit leg-quote window and the close decision window are policy, and both are the same ones the single-leg close path uses */
export const definedRiskMaximumQuoteAgeSeconds = 30;
export const definedRiskDecisionWindowSeconds = 60;
/** distance of the spot from the SHORT strike (as a fraction) that is treated as pin risk on the last day; the same band as the registered expiry classifier test vectors */
export const definedRiskPinBandPct = 0.002;

export interface DefinedRiskRuntimeInput {
  readonly pool: Pool;
  readonly alpaca: AlpacaProviderConfig;
  /** the ONE PaperOrderCoordinator construction site is src/theta/autonomous-runtime.ts (architecture guard); it is handed in, never built here */
  readonly coordinator: PaperOrderCoordinator;
  readonly orders: PaperOrderStore;
  readonly executionAccountId: string;
  readonly reconciliation: { readonly snapshotId: string; readonly marketOpen: boolean | null; readonly dataQuality: 'GOOD' | 'UNKNOWN'; readonly observedAt: string };
  readonly managementSubmissionEnabled: boolean;
  readonly now?: () => string;
}

const easternDate = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const calendarDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);

/**
 * The production binding of the D management scan: reads ONLY broker/provider truth for the inputs and hands the decision to the same PaperOrderCoordinator the single-leg
 * path uses. Inert (returns []) when no spread is active, so it can sit in the management job permanently without touching Wheel behaviour.
 */
export async function runDefinedRiskManagementForRuntime(input: DefinedRiskRuntimeInput): Promise<readonly DefinedRiskScanResult[]> {
  const now = input.now ?? ((): string => new Date().toISOString());
  const positions = new PostgresDefinedRiskPositionStore(input.pool);
  const active = await positions.activePositions();
  if (active.length === 0) return [];
  const recorder = new PostgresDefinedRiskDecisionRecorder(input.pool);
  const mayClose = input.managementSubmissionEnabled && input.reconciliation.marketOpen === true && input.reconciliation.dataQuality === 'GOOD';
  const loadInputs = async (position: DefinedRiskPositionSnapshot, observedAt: string): Promise<DefinedRiskScanInputs> => {
    const detail = await withRuntimePostgresReadRetry(input.pool, (client) => client.query(`SELECT u.symbol AS underlying,
        (SELECT l.occ_symbol FROM trade.order_intent_leg l WHERE l.order_intent_id=$1 AND l.position_intent='sell_to_open') AS short_symbol,
        (SELECT l.occ_symbol FROM trade.order_intent_leg l WHERE l.order_intent_id=$1 AND l.position_intent='buy_to_open') AS long_symbol
      FROM market.underlying u WHERE u.underlying_id=$2`, [position.orderIntentId, position.underlyingId]));
    const row = detail.value.rows[0] as { underlying: string; short_symbol: string; long_symbol: string } | undefined;
    if (row === undefined) throw new Error('DEFINED_RISK_POSITION_IDENTITY_NOT_FOUND');
    // broker legs: a leg ABSENT from a GOOD reconciliation snapshot is zero contracts; with a non-GOOD snapshot every leg count is UNKNOWN (never assumed)
    let brokerOpenContracts: DefinedRiskScanInputs['brokerOpenContracts'] = { short: null, long: null };
    if (input.reconciliation.dataQuality === 'GOOD') {
      const positionsRead = await withRuntimePostgresReadRetry(input.pool, (client) => client.query(`SELECT symbol, quantity::float AS quantity, side FROM trade.broker_position_snapshot
        WHERE reconciliation_snapshot_id=$1 AND symbol = ANY($2)`, [input.reconciliation.snapshotId, [row.short_symbol, row.long_symbol]]));
      const contracts = (symbol: string, side: 'short' | 'long'): number | null => {
        const found = (positionsRead.value.rows as Array<{ symbol: string; quantity: number | null; side: string | null }>).find((item) => item.symbol === symbol);
        if (found === undefined) return 0;
        if (found.quantity === null || found.side === null) return null;
        return found.side.toLowerCase() === side ? Math.abs(found.quantity) : null;
      };
      brokerOpenContracts = { short: contracts(row.short_symbol, 'short'), long: contracts(row.long_symbol, 'long') };
    }
    const snapshots = await fetchOptionSnapshots(input.alpaca, { underlyingSymbol: row.underlying, feed: 'indicative', optionType: 'put', expirationDateGte: position.expiration, expirationDateLte: position.expiration,
      strikePriceGte: position.longStrike, strikePriceLte: position.shortStrike, limit: 1000, maxPages: 10 });
    const leg = (symbol: string) => {
      const quote = snapshots.complete ? snapshots.snapshots.get(symbol) : undefined;
      return quote === undefined ? null : { symbol, bid: quote.bid, ask: quote.ask, observedAt: quote.quoteTimestamp };
    };
    const shortQuote = leg(row.short_symbol), longQuote = leg(row.long_symbol);
    const stock = await fetchLatestStockQuote(input.alpaca, row.underlying, 'iex').catch(() => null);
    const spot = stock !== null && stock.bid !== null && stock.ask !== null && stock.bid > 0 && stock.ask >= stock.bid ? (stock.bid + stock.ask) / 2 : null;
    const executableQuotes = shortQuote?.bid != null && shortQuote.ask != null && longQuote?.bid != null && longQuote.ask != null;
    return { brokerOpenContracts, shortQuote, longQuote, spot, dte: calendarDays(easternDate(observedAt), position.expiration), marketOpen: input.reconciliation.marketOpen,
      // event / AEGIS-deterioration feeds are not wired for open spreads yet: they stay UNKNOWN (never CLEAR / ALLOW by default)
      context: { eventState: 'UNKNOWN', aegisState: null, executionQuality: executableQuotes ? 'GOOD' : 'UNKNOWN' }, aegisState: null, executionAccountId: input.executionAccountId };
  };
  return runDefinedRiskManagementScan({ positions, orders: input.orders, coordinator: input.coordinator, loadInputs, mayClose,
    recordDecision: (decision, position) => recorder.record(decision, position), nextCloseAttempt: (id) => recorder.nextCloseAttempt(id),
    pinBandPct: definedRiskPinBandPct, maximumQuoteAgeSeconds: definedRiskMaximumQuoteAgeSeconds, decisionWindowSeconds: definedRiskDecisionWindowSeconds, now });
}
