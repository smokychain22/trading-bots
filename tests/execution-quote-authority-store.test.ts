import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresRuntimeCycleStore } from '../src/theta/autonomous-runtime.js';

const poolReturning = (ready: boolean) => ({
  query: async (sql: string) => {
    assert.match(sql, /OPTIONS_MARKET_DATA_OPRA/);
    assert.match(sql, /OPTIONS_MARKET_DATA_INDICATIVE/);
    assert.match(sql, /ORDER_PRICING_DOCUMENTED/);
    assert.doesNotMatch(sql, /INDICATIVE_ONLY/);
    return { rows: [{ ready }], rowCount: 1 };
  },
}) as unknown as Pool;

test('new-risk runtime remains locked when no persisted execution quote authority is qualified', async () => {
  const store = new PostgresRuntimeCycleStore(poolReturning(false));
  assert.equal(await store.executionQuoteAuthorityReady(), false);
});

test('new-risk runtime accepts only a persisted qualified execution quote authority result', async () => {
  const store = new PostgresRuntimeCycleStore(poolReturning(true));
  assert.equal(await store.executionQuoteAuthorityReady(), true);
});
