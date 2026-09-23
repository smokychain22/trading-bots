import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import {
  buildHistoricalReplayExport,
  historicalReplayRowFromDatabase,
  type HistoricalReplayDatabaseRow,
} from '../src/research/historical-replay-export.js';

const databaseRow = (overrides: Partial<HistoricalReplayDatabaseRow> = {}): HistoricalReplayDatabaseRow => ({
  candidate_id: 'candidate-1',
  candidate_set_id: 'cycle-1',
  decision_id: 'decision-1',
  fusion_snapshot_id: 'snapshot-1',
  decision_time: '2026-09-21T15:00:00.000Z',
  branch: 'THETA_CONVENTIONAL',
  selected: false,
  rejection_reason: 'QUOTE_STALE',
  contract_json: { underlying: 'SPY', dte: 30, strike: '500', optionType: 'PUT' },
  market_json: { bid: '1.20', ask: '1.30', quoteTimestamp: '2026-09-21T14:59:45.000Z' },
  event_json: { state: { populated: false } },
  aegis_json: { state: { newRiskState: 'HOLD_ONLY' } },
  execution_json: { executable: false },
  hard_blockers_json: ['QUOTE_STALE'],
  candidate_metrics_json: {
    contract: { delta: '-0.22' },
    decisionAlternative: { quantity: 0, disposition: 'REJECTED', aegisState: 'HOLD_ONLY' },
  },
  quote_observation_id: 'quote-1',
  quote_provider_timestamp: '2026-09-21T14:59:45.000Z',
  quote_ingestion_timestamp: '2026-09-21T14:59:46.000Z',
  ...overrides,
});

test('historical replay mapper preserves real numeric strings and explicit information states', () => {
  const row = historicalReplayRowFromDatabase(databaseRow());
  assert.equal(row.symbol, 'SPY');
  assert.equal(row.strike, 500);
  assert.equal(row.delta, -0.22);
  assert.equal(row.bid, 1.2);
  assert.equal(row.ask, 1.3);
  assert.equal(row.eventState, 'EMPTY_UNQUALIFIED');
  assert.equal(row.sizingState, 'ZERO_QUANTITY');
  assert.deepEqual(row.rejectionCodes, ['QUOTE_STALE']);
  assert.deepEqual(row.persistedEvidenceIds, ['candidate-1', 'cycle-1', 'snapshot-1', 'decision-1', 'quote-1']);
});

test('historical replay mapper rejects missing underlying rather than inventing a symbol', () => {
  assert.throws(() => historicalReplayRowFromDatabase(databaseRow({ contract_json: { dte: 30 } })),
    /HISTORICAL_REPLAY_UNDERLYING_MISSING/);
});

test('historical replay export is read-only, release-bound, validated and canonically hashed', async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT')) return { rows: [databaseRow()] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const artifact = await buildHistoricalReplayExport({
    pool,
    sessionDates: ['2026-09-21'],
    canonicalSourceSha: 'a'.repeat(40),
    generatedAt: '2026-09-23T12:00:00.000Z',
  });
  assert.equal(queries[0], 'BEGIN TRANSACTION READ ONLY');
  assert.equal(queries.at(-1), 'COMMIT');
  assert.equal(artifact.rowCount, 1);
  assert.equal(artifact.symbolCount, 1);
  assert.equal(artifact.importIssueCount, 0);
  assert.match(artifact.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(artifact.brokerAuthority, false);
  assert.deepEqual(artifact.providerAuthorities, ['ALPACA_EXECUTABLE_MARKET', 'THETA_PERSISTED_DECISION']);
});
