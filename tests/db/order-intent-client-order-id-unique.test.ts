import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Runs inside a transaction that is always rolled back, so it leaves no residue even on a shared test database.
test('the database itself rejects a second order intent with the same clientOrderId (idempotency is not only application-level)',
  { skip: databaseUrl === undefined }, async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica'); // no upstream decision chain needed for this constraint
      const clientOrderId = `theta-unique-${randomUUID()}`;
      const insert = (id: string, coid: string) => client.query(
        `INSERT INTO trade.order_intent(order_intent_id,client_order_id,status,instrument_type,side,quantity,position_intent,
           canonical_quantity,paper_evidence_quantity)
         VALUES($1,$2,'PROPOSED','OPTION','sell',1,'SELL_TO_OPEN',1,1)`, [id, coid]);
      await insert(randomUUID(), clientOrderId);
      await client.query('SAVEPOINT duplicate');
      await assert.rejects(() => insert(randomUUID(), clientOrderId), (error: { code?: string }) => error.code === '23505',
        'duplicate clientOrderId must violate the unique constraint');
      await client.query('ROLLBACK TO SAVEPOINT duplicate');
      // A different attempt number yields a different deterministic id and is allowed.
      await insert(randomUUID(), `${clientOrderId}-attempt-2`);
    } finally {
      try { await client.query('ROLLBACK'); } catch { /* connection already unusable */ }
      client.release();
      await pool.end();
    }
  });
