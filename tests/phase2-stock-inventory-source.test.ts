import assert from 'node:assert/strict';
import test from 'node:test';
import { AlpacaStockInventorySource } from '../src/execution/alpaca-stock-inventory-source.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';

const NOW = '2026-10-13T14:00:00.000Z';

// Mock Alpaca REST: GET /v2/positions and GET /v2/orders only. No credentials are real and nothing leaves the process.
function source(positions: unknown[] | 'ERROR', orders: unknown[] = []): { source: AlpacaStockInventorySource; paths: string[] } {
  const paths: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/v2/positions') {
      if (positions === 'ERROR') return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => positions };
    }
    if (url.pathname === '/v2/orders') return { ok: true, status: 200, json: async () => orders };
    throw new Error(`unexpected path ${url.pathname}`);
  }) as unknown as typeof fetch;
  const config: AlpacaProviderConfig = { tradingApiBase: 'https://paper-api.alpaca.markets', marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: 'test-key', apiSecret: 'test-secret', fetchImpl };
  return { source: new AlpacaStockInventorySource(config, () => NOW), paths };
}

const equity = (qty: string, side = 'long', symbol = 'AAPL') => ({ symbol, asset_class: 'us_equity', qty, side, avg_entry_price: '195', market_value: '19000', unrealized_pl: '-500' });
const shortCall = (qty: string) => ({ symbol: 'AAPL261120C00205000', asset_class: 'us_option', qty: `-${qty}`, side: 'short', avg_entry_price: '1', market_value: '-100', unrealized_pl: '0' });

test('inventory source: long shares are the signed broker quantity, observed at the read time; only read endpoints are touched', async () => {
  const { source: reader, paths } = source([equity('100'), equity('50', 'long', 'MSFT')]);
  const read = await reader.readStockInventory('AAPL');
  assert.deepEqual(read.inventory, { state: 'KNOWN', quantity: 100, observedAt: NOW, reason: null });
  assert.equal(read.committedShortCallContracts, 0);
  assert.deepEqual([...new Set(paths)].sort(), ['/v2/orders', '/v2/positions']);
});

test('inventory source: no position row is a KNOWN zero; short stock is negative; unreadable rows are UNKNOWN, never zero', async () => {
  assert.equal((await source([]).source.readStockInventory('AAPL')).inventory.quantity, 0);
  assert.equal((await source([equity('100', 'short')]).source.readStockInventory('AAPL')).inventory.quantity, -100);
  const noSide = await source([{ ...equity('100'), side: null }]).source.readStockInventory('AAPL');
  assert.deepEqual([noSide.inventory.state, noSide.inventory.reason], ['UNKNOWN', 'BROKER_POSITION_SIDE_UNKNOWN']);
  const noQty = await source([{ ...equity('100'), qty: null }]).source.readStockInventory('AAPL');
  assert.deepEqual([noQty.inventory.state, noQty.inventory.reason], ['UNKNOWN', 'BROKER_POSITION_QUANTITY_INVALID']);
  const duplicate = await source([equity('100'), equity('100')]).source.readStockInventory('AAPL');
  assert.equal(duplicate.inventory.state, 'UNKNOWN');
});

test('inventory source: committed short calls come from LIVE positions and open sell-to-open orders, and unknown order rows fail closed', async () => {
  const withCalls = await source([equity('300'), shortCall('2')], [{ id: 'o1', client_order_id: 'c1', symbol: 'AAPL261120C00210000', side: 'sell', position_intent: 'sell_to_open', qty: '1', filled_qty: '0', status: 'new', type: 'limit' }]).source.readStockInventory('AAPL');
  assert.equal(withCalls.committedShortCallContracts, 3);
  const ambiguous = await source([equity('100')], [{ id: 'o2', client_order_id: 'c2', symbol: 'AAPL261120C00210000', side: 'sell', position_intent: null, qty: '1', filled_qty: '0', status: 'new', type: 'limit' }]).source.readStockInventory('AAPL');
  assert.equal(ambiguous.committedShortCallContracts, null, 'a sell of a call with no position intent cannot be proven not to be a short call');
});

test('inventory source: a failed broker read throws (the handoff turns it into a typed block); it never falls back to a ledger count', async () => {
  await assert.rejects(source('ERROR').source.readStockInventory('AAPL'));
});
