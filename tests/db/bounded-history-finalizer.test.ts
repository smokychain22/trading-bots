import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { buildFinalChainReceipt } from '../../src/storage/data-platform/final-chain-receipt.js';
import { finalizeSession } from '../../src/storage/data-platform/session-finalizer.js';

const url = process.env.THETA_DATA_PLATFORM_DATABASE_URL;
const skip = url === undefined;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const decision = {
  decisionId: uuid(1),
  decidedAt: '2026-10-02T19:00:00.000Z',
  action: 'WAIT',
  strategy: 'Q',
  selectedCandidateId: null,
  quantity: '0',
  aegisOutcome: 'ALLOW',
  sizingOutcome: 'ZERO',
  bindingConstraint: 'ACCOUNT_CAPACITY',
  chainId: null,
  archivalTerminal: true,
  policyVersions: { entry: 'v1' },
  sourceSha: 'a'.repeat(40),
  archiveId: 'b'.repeat(40),
  archiveHash: 'c'.repeat(64),
} as const;

test('REAL POSTGRES: schema 071 finalizes a session atomically, chains the root and is idempotent', { skip }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS dp CASCADE');
    await pool.query(readFileSync(new URL('../../docs/proposals/069_data_platform_DRAFT.sql', import.meta.url), 'utf8'));
    await pool.query(readFileSync(new URL('../../docs/proposals/071_bounded_historical_truth_DRAFT.sql', import.meta.url), 'utf8'));
    const receipt = buildFinalChainReceipt({
      state: {
        chainId: uuid(2), lifecycleTerminal: true, openOptionExposure: false, openStockExposure: false,
        workingOrder: false, partialFill: false, unknownResultOrder: false, reconciliationPending: false,
        managementTerminal: true, orders: 'RESOLVED', fills: 'RESOLVED', inventory: 'NOT_APPLICABLE',
        assignment: 'NOT_APPLICABLE', wholeChainEconomics: 'RESOLVED', futureObservationLabels: 'PROVIDER_LIMITED_UNKNOWN',
      },
      finalizedAt: '2026-10-02T21:00:00.000Z', sourceSha: 'a'.repeat(40), policyVersion: 'v1',
    });
    const input = {
      sessionId: 'XNYS-2026-10-02', sessionDate: '2026-10-02', decisions: [decision], finalChainReceipts: [receipt],
      finalizedExecutionHistories: [{ chainId: uuid(2), finalizedAt: '2026-10-02T21:00:00.000Z', finalChainReceipt: receipt,
        orders: [], fills: [], inventory: [], assignmentExerciseExpiration: [], managementActions: [], wholeChainEconomics: { realizedPnl: '0' }, outcomeLabels: [], provenance: { authority: 'BROKER_ACTUAL' }, sourceSha: 'a'.repeat(40), policyVersion: 'v1' }],
      parquetManifestHashes: ['d'.repeat(64)], sourceSha: 'a'.repeat(40), policyVersions: { storage: 'v1' },
      schemaVersions: ['071'], finalizedAt: '2026-10-02T21:00:00.000Z',
    } as const;
    const first = await finalizeSession(pool, input);
    assert.equal(first.state, 'PERSISTED');
    assert.equal(first.decisionsWritten, 1);
    assert.equal(first.finalChainReceiptsWritten, 1);
    assert.equal(first.finalizedExecutionHistoriesWritten, 1);
    const second = await finalizeSession(pool, input);
    assert.equal(second.state, 'IDEMPOTENT');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dp.recent_decision_audit')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dp.final_chain_receipt')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dp.finalized_execution_history')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dp.session_integrity_manifest')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dp.session_integrity_head')).rows[0].n, 1);
  } finally { await pool.end(); }
});
