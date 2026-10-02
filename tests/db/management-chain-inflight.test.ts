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
      underlying: 'SPY', entryBlockingFactCount: 0 });
    assert.deepEqual(errors, []);
    assert.equal(committed, null, 'a reconciliation snapshot that does not exist cannot prove the commitment is zero');
    assert.equal(await readCommittedShortCallContracts(watched, { executionAccountId: none, reconciliationSnapshotId: none,
      underlying: 'SPY', entryBlockingFactCount: 1 }), null);
    // Real snapshot (rolled back): FK checks are bypassed inside this one disposable transaction only.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      const snapshot = '00000000-0000-4000-8000-0000000000a1', hash = 'a'.repeat(64);
      await client.query(`INSERT INTO trade.broker_reconciliation_snapshot(reconciliation_snapshot_id,connection_id,correlation_id,environment,
        broker_host,observed_at,data_quality,payload_hash) VALUES($1,$2,'commit-reader-test','PAPER','paper-api.alpaca.markets',now(),'GOOD',$3)`,
      [snapshot, none, hash]);
      await client.query(`INSERT INTO trade.broker_position_snapshot(reconciliation_snapshot_id,connection_id,symbol,quantity,side,asset_class,observed_at,payload_hash)
        VALUES($1,$2,'SPY261120C00500000',-2,'short','us_option',now(),$3)`, [snapshot, none, hash]);
      const inTransaction = { query: async (text: string, values?: unknown[]) => client.query(text, values) };
      assert.equal(await readCommittedShortCallContracts(inTransaction, { executionAccountId: none, reconciliationSnapshotId: snapshot,
        underlying: 'SPY', entryBlockingFactCount: 0 }), 2);
      assert.equal(await readCommittedShortCallContracts(inTransaction, { executionAccountId: none, reconciliationSnapshotId: snapshot,
        underlying: 'AAPL', entryBlockingFactCount: 0 }), 0);
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
    assert.deepEqual(errors, []);
  } finally { await pool.end(); }
});
