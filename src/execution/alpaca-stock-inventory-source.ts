import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { fetchOpenOrders, fetchPositions } from '../theta/alpaca-provider.js';
import { deriveCommittedShortCallContracts } from '../theta/account-exposure.js';
import type { BrokerStockInventoryEvidence } from '../theta/stock-share-reconciliation.js';

/** Fresh, read-only broker truth for a stock exit, taken at submit time (not the scan-time snapshot). */
export interface StockInventoryRead {
  readonly inventory: BrokerStockInventoryEvidence;
  /** Short-call contracts committed on the underlying according to the LIVE broker positions + open orders; null = UNKNOWN. */
  readonly committedShortCallContracts: number | null;
}

export interface StockInventorySource {
  readStockInventory(symbol: string, now: string): Promise<StockInventoryRead>;
}

/**
 * Read-only Alpaca implementation (GET /v2/positions, GET /v2/orders). It has no mutation surface. Any read failure throws
 * and the handoff turns that into a typed block; it never falls back to the ledger count.
 */
export class AlpacaStockInventorySource implements StockInventorySource {
  constructor(private readonly alpaca: AlpacaProviderConfig, private readonly clock: () => string = () => new Date().toISOString()) {}

  async readStockInventory(symbol: string): Promise<StockInventoryRead> {
    const receivedAt = this.clock();
    const [positions, orders] = await Promise.all([fetchPositions(this.alpaca, receivedAt), fetchOpenOrders(this.alpaca, receivedAt)]);
    const rows = positions.filter((position) => position.symbol === symbol);
    const equity = rows.filter((position) => position.assetClass === 'us_equity' || position.assetClass === null);
    let inventory: BrokerStockInventoryEvidence;
    if (equity.length > 1) inventory = { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_QUANTITY_INVALID' };
    else if (equity[0] === undefined) inventory = { state: 'KNOWN', quantity: 0, observedAt: receivedAt, reason: null };
    else {
      const row = equity[0];
      const side = row.side?.toLowerCase() ?? null;
      if (row.quantity === null || !Number.isFinite(row.quantity)) {
        inventory = { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_QUANTITY_INVALID' };
      } else if (side !== 'long' && side !== 'short') {
        inventory = { state: 'UNKNOWN', quantity: null, observedAt: null, reason: 'BROKER_POSITION_SIDE_UNKNOWN' };
      } else {
        inventory = { state: 'KNOWN', quantity: side === 'long' ? Math.abs(row.quantity) : -Math.abs(row.quantity), observedAt: receivedAt, reason: null };
      }
    }
    return { inventory, committedShortCallContracts: deriveCommittedShortCallContracts(symbol, positions, orders) };
  }
}
