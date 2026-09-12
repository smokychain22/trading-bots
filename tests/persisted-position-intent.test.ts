import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { persistedPositionIntent, PostgresPaperOrderStore } from '../src/execution/postgres-paper-order-store.js';
import type { PersistedPaperOrderIntent } from '../src/execution/paper-order-coordinator.js';

test('persisted option intents reject missing, invalid and contradictory evidence', () => {
  for (const raw of [undefined, null, '', 'null', 'UNKNOWN'])
    assert.throws(() => persistedPositionIntent('OPTION', 'sell', raw));
  assert.throws(() => persistedPositionIntent('OPTION', 'buy', 'SELL_TO_OPEN'));
  assert.throws(() => persistedPositionIntent('UNKNOWN', 'sell', 'SELL_TO_OPEN'));
});

test('all four explicit position intents survive storage decoding', () => {
  for (const intent of ['BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE']) {
    assert.equal(persistedPositionIntent('OPTION', intent.split('_')[0]?.toLowerCase(), intent), intent.toLowerCase());
  }
});

test('stock orders omit option intent without converting NULL to a string', () => {
  assert.equal(persistedPositionIntent('STOCK', 'sell', null), undefined);
  assert.throws(() => persistedPositionIntent('STOCK', 'sell', 'SELL_TO_CLOSE'));
});

test('stock persistence records STOCK and decoding omits position_intent', async () => {
  let stored: readonly unknown[] = [];
  const pool = { query: async (sql: string, values: readonly unknown[]) => {
    if (sql.includes('INSERT INTO')) { stored = values; return { rows: [] }; }
    return { rows: [{
      order_intent_id: stored[0], execution_account_id: stored[1], decision_id: stored[2],
      client_order_id: stored[3], status: stored[4], broker_symbol: stored[5],
      side: stored[6], quantity: stored[7], limit_price: stored[8], time_in_force: stored[9],
      theta_action: stored[10], position_intent: stored[11], intent_persisted_at: stored[12],
      instrument_type: stored[13],chain_id:stored[14],option_contract_id:stored[15],underlying_id:stored[16],
      quote_as_of:stored[17],decision_expires_at:stored[18],aegis_state:stored[19],quote_source:stored[20],
      quote_feed:stored[21],quote_content_hash:stored[22],provider_order_id: null,
    }] };
  } } as unknown as Pool;
  const store = new PostgresPaperOrderStore(pool);
  const intent: PersistedPaperOrderIntent = {
    orderIntentId: 'intent', executionAccountId: 'account', decisionId: 'decision',
    action: 'SELL_STOCK', status: 'READY', persistedAt: '2026-09-11T00:00:00Z', brokerOrderId: null,
    chainId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',optionContractId:null,underlyingId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    executionEvidence:{quoteSource:'ALPACA',quoteFeed:'SIP',quoteAsOf:'2026-09-11T00:00:00Z',
      decisionExpiresAt:'2026-09-11T00:01:00Z',quoteContentHash:'a'.repeat(64),aegisState:'HOLD_ONLY'},
    request: { symbol: 'AAPL', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day',
      limit_price: '100', client_order_id: 'test-stock' },
  };
  await store.insertIntent(intent);
  assert.equal(stored[13], 'STOCK');
  assert.equal(stored[11], null);
  assert.deepEqual(await store.getIntent('intent'), intent);
});

test('option persistence rejects absent intent before issuing SQL', async () => {
  let queries = 0;
  const pool = { query: async () => { queries++; return { rows: [] }; } } as unknown as Pool;
  const store = new PostgresPaperOrderStore(pool);
  await assert.rejects(store.insertIntent({
    orderIntentId: 'intent', executionAccountId: 'account', decisionId: 'decision',
    action: 'OPEN_CSP', status: 'READY', persistedAt: '2026-09-11T00:00:00Z', brokerOrderId: null,
    chainId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',optionContractId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',underlyingId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    executionEvidence:{quoteSource:'ALPACA',quoteFeed:'OPRA',quoteAsOf:'2026-09-11T00:00:00Z',
      decisionExpiresAt:'2026-09-11T00:01:00Z',quoteContentHash:'a'.repeat(64),aegisState:'ALLOW_FULL'},
    request: { symbol: 'AAPL261016P00100000', qty: 1, side: 'sell', type: 'limit', time_in_force: 'day',
      limit_price: '1', client_order_id: 'test-option' },
  }));
  assert.equal(queries, 0);
});
