import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresRuntimeCycleStore } from '../src/theta/autonomous-runtime.js';

const poolReturning = (ready: boolean) => ({
  query: async (sql: string) => {
    assert.match(sql, /OPTIONS_MARKET_DATA_OPRA/);
    assert.match(sql, /OPTIONS_MARKET_DATA_INDICATIVE/);
    assert.match(sql, /PAPER_INDICATIVE_REFERENCE/);
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

test('first Paper canary is available only before any broker order has been persisted', async () => {
  const emptyStore = new PostgresRuntimeCycleStore({
    query: async (sql: string) => {
      assert.match(sql, /count\(\*\)::int AS count FROM trade\.broker_order/);
      return { rows: [{ count: 0 }], rowCount: 1 };
    },
  } as unknown as Pool);
  const usedStore = new PostgresRuntimeCycleStore({
    query: async () => ({ rows: [{ count: 1 }], rowCount: 1 }),
  } as unknown as Pool);

  assert.equal(await emptyStore.firstCanarySubmissionAvailable(), true);
  assert.equal(await usedStore.firstCanarySubmissionAvailable(), false);
});
