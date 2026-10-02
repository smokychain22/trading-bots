import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { readCommittedShortCallContracts, readManagementChainInFlight } from '../../src/execution/management-chain-inflight.js';

// The readers fail closed (swallow SQL errors into UNKNOWN), so a column typo would silently block all management forever.
// This test runs both against the real migrated schema and fails if any statement errors.
test('chain in-flight and committed-short-call readers compile and run against the migrated PostgreSQL schema', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const errors: string[] = [];
  const watched = { query: async (text: string, values?: unknown[]) => {
    try { return await pool.query(text, values); } catch (error) { errors.push(String((error as Error).message)); throw error; }
  } };
  try {
    const none = '00000000-0000-0000-0000-000000000000';
    const inflight = await readManagementChainInFlight(watched, none, none);
    assert.deepEqual(errors, []);
    assert.deepEqual(inflight, { state: 'KNOWN', entries: [] });
    const committed = await readCommittedShortCallContracts(watched, { executionAccountId: none, reconciliationSnapshotId: none,
      underlying: 'SPY', externalOrUnknownCount: 0 });
    assert.deepEqual(errors, []);
    assert.equal(committed, 0);
    assert.equal(await readCommittedShortCallContracts(watched, { executionAccountId: none, reconciliationSnapshotId: none,
      underlying: 'SPY', externalOrUnknownCount: 1 }), null);
  } finally { await pool.end(); }
});
