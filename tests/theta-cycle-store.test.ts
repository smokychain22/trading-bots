import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { deterministicRuntimeUuid, PostgresThetaCycleStore } from '../src/theta/postgres-theta-cycle-store.js';

test('runtime persistence IDs are deterministic UUIDs without exposing raw identifiers', () => {
  const first = deterministicRuntimeUuid('fusion:bot:hash');
  assert.equal(first, deterministicRuntimeUuid('fusion:bot:hash'));
  assert.notEqual(first, deterministicRuntimeUuid('fusion:bot:other'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.includes('fusion'), false);
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
