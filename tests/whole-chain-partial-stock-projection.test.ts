import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { PostgresWholeChainComponentsRepository } from '../src/theta/postgres-whole-chain-components-repository.js';

const asOf = '2026-09-18T15:00:00.000Z';
const acquiredAt = '2026-09-16T15:00:00.000Z';

async function loadProjection(disposedShares = 100, assignedShares = 200, exitPrice: number | null = 90) {
  let released = 0;
  const statements: string[] = [];
  // Synthetic rows exercise the public repository/transaction/normalization
  // path. SQL/PIT semantics are separately exercised in the disposable DB suite.
  const client = Object.assign(new EventEmitter(), {
    release() { released++; },
    async query(sql: string) {
      statements.push(sql);
      let rows: Record<string, unknown>[];
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) rows = [];
      else if (sql.includes('SELECT ec.chain_id')) rows = [{ chain_id: 'chain', account_id: 'account', underlying_id: 'underlying', symbol: 'TEST' }];
      else if (sql.includes('SELECT COALESCE(sum(sl.shares)')) rows = [{ shares: 100 }];
      else if (sql.includes('SELECT l.option_leg_id')) rows = [{ option_leg_id: 'put', side: 'SHORT', option_type: 'PUT',
        entry_credit_debit: 300, opened_at: acquiredAt, closed_at: acquiredAt, close_reason: 'ASSIGNED' }];
      else if (sql.includes('SELECT ae.assignment_event_id')) rows = [
        { assignment_event_id: 'assignment-open', option_type: 'PUT', stock_lot_id: 'open', shares: 100, strike_price: 100, assigned_at: acquiredAt },
        { assignment_event_id: 'assignment-sold', option_type: 'PUT', stock_lot_id: 'sold', shares: assignedShares - 100, strike_price: 100, assigned_at: acquiredAt },
      ];
      else if (sql.includes('SELECT stock_lot_id')) rows = [
        { stock_lot_id: 'open', shares: 100, economic_basis_per_share: 100, acquired_at: acquiredAt, disposed_at: null },
        { stock_lot_id: 'sold', shares: disposedShares, economic_basis_per_share: 100, acquired_at: acquiredAt,
          disposed_at: asOf, disposed_price_per_share: exitPrice },
      ];
      else if (sql.includes('SELECT brs.reconciliation_snapshot_id')) rows = [{ reconciliation_snapshot_id: 'recon', data_quality: 'GOOD',
        quantity: 100, current_price: 105, observed_at: asOf, provider_timestamp: asOf }];
      else if (sql.includes('SELECT f.fill_id')) rows = [{ fill_id: 'fill', fees: 0, filled_at: acquiredAt }];
      else if (sql.includes('SELECT ee.expiration_event_id') || sql.includes('SELECT de.dividend_event_id')
        || sql.includes('SELECT fee_event_id') || sql.includes('SELECT oi.order_intent_id')) rows = [];
      else throw new Error('UNEXPECTED_TEST_QUERY');
      return { rows, rowCount: rows.length };
    },
  });
  const pool = { connect: async () => client as unknown as PoolClient } as unknown as Pool;
  const result = await new PostgresWholeChainComponentsRepository(pool).load('chain', asOf, { connectionId: 'connection' });
  assert.equal(released, 1);
  assert.equal(statements.at(-1), 'COMMIT');
  return result;
}

test('repository preserves realized partial stock exits and provenance while remaining shares retain their mark', async () => {
  const result = await loadProjection();
  assert.equal(result.stockSharesAssigned.value, 200);
  assert.equal(result.openStockShares.value, 100);
  assert.equal(result.stockSaleOrCallAwayProceeds.value, 9000);
  assert.equal(result.stockSaleOrCallAwayProceeds.status, 'KNOWN');
  assert.equal(result.currentStockMarkPerShare.value, 105);
  assert.ok(result.stockSaleOrCallAwayProceeds.sources[0]?.recordIds.includes('sold'));
  assert.equal(result.components, null, 'unverified dividend coverage still prevents complete cash P&L');
});

test('repository never fabricates partial disposal cashflows with missing price or broken assignment coverage', async () => {
  assert.equal((await loadProjection(100, 200, null)).stockSaleOrCallAwayProceeds.status, 'UNKNOWN');
  const mismatch = await loadProjection(50, 200);
  assert.equal(mismatch.stockSharesAssigned.status, 'UNKNOWN');
  assert.equal(mismatch.stockSaleOrCallAwayProceeds.status, 'UNKNOWN');
});
