import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { alpacaQuoteSnapshotRow, deterministicRuntimeUuid, PostgresThetaCycleStore } from '../src/theta/postgres-theta-cycle-store.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';

test('runtime persistence IDs are deterministic UUIDs without exposing raw identifiers', () => {
  const first = deterministicRuntimeUuid('fusion:bot:hash');
  assert.equal(first, deterministicRuntimeUuid('fusion:bot:hash'));
  assert.notEqual(first, deterministicRuntimeUuid('fusion:bot:other'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.includes('fusion'), false);
});

test('quote ledger projects timestamped Alpaca BBO with feed and quality, including non-executable observations', () => {
  const observedAt = '2026-09-21T15:00:00.000Z';
  const receivedAt = '2026-09-21T15:00:02.000Z';
  const raw = {
    source: 'ALPACA' as const, underlying: 'SPY', optionSymbol: 'SPY261009P00500000',
    occSymbol: 'SPY261009P00500000', optionType: 'PUT' as const, strike: 500,
    expiration: '2026-10-09', asOfDate: '2026-09-21', multiplier: 100,
    underlyingBid: 500, underlyingAsk: 500.02, underlyingLast: 500.01, underlyingTimestamp: observedAt,
    bid: 2.5, ask: 2.6, bidSize: 20, askSize: 10, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: observedAt, tradeTimestamp: null, volume: null, volumeSource: null,
    openInterest: null, openInterestSource: null, iv: null, delta: null, gamma: null, theta: null,
    vega: null, rho: null, greeksTimestamp: null, greeksSource: null, feed: 'INDICATIVE' as const,
    dataQuality: 'STALE' as const, maxQuoteAgeSecondsForExecutable: 1,
    maxSpreadPctForExecutable: 0.1,
  };
  const contract = normalizeOptionContract(raw, receivedAt);
  assert.equal(contract.executable, false);
  assert.deepEqual(alpacaQuoteSnapshotRow(contract), {
    contractSymbol: raw.occSymbol, bid: 2.5, ask: 2.6, bidSize: 20, askSize: 10,
    lastPrice: null, asOf: observedAt, retrievedAt: receivedAt, feed: 'INDICATIVE', quality: 'STALE',
  });
  assert.equal(alpacaQuoteSnapshotRow(normalizeOptionContract({ ...raw, source: 'OPTIONOMICS', feed: null }, receivedAt)), null);
  assert.equal(alpacaQuoteSnapshotRow(normalizeOptionContract({ ...raw, quoteTimestamp: null }, receivedAt)), null);
  assert.equal(alpacaQuoteSnapshotRow(normalizeOptionContract({ ...raw, quoteTimestamp: '2026-09-21T15:01:00.000Z' }, receivedAt)), null);
  assert.equal(alpacaQuoteSnapshotRow(normalizeOptionContract({ ...raw, bid: null, ask: null }, receivedAt)), null);
});

test('raw event observations persist even when no derived Optionomics feature snapshot exists', async () => {
  const statements: string[] = [];
  const client = { query: async (sql: string) => { statements.push(sql); return { rows: [], rowCount: 1 }; } } as unknown as PoolClient;
  const store = new PostgresThetaCycleStore({} as Pool) as unknown as {
    persistOptionomicsEvidence(client: PoolClient, id: string, snapshot: Record<string, unknown>): Promise<void>;
  };
  await store.persistOptionomicsEvidence(client, deterministicRuntimeUuid('test-fusion'), {
    underlyingState: { symbol: 'SPY' },
    optionomicsFeatureState: { features: {}, rawObservations: [{
      operationAlias: 'optionomics.list_events', responseHash: 'a'.repeat(64),
      retrievedAt: '2026-09-21T12:00:00.000Z', payload: { events: [{
        id: 'event-1', kind: 'macro', date: '2026-09-23', known_at: '2026-09-20T12:00:00Z',
      }] },
    }] },
  });
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO market.optionomics_raw_observation')), true);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO market.optionomics_event_first_observation')), true);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO market.optionomics_feature_snapshot')), false);
});
