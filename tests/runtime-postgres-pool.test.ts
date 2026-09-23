import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimePostgresPool } from '../src/theta/runtime-postgres-pool.js';

test('idle Postgres disconnect is handled and reported without secret-bearing error text', async () => {
  const codes: string[] = [];
  const pool = createRuntimePostgresPool('postgres://user:secret@localhost:5432/test', (code) => codes.push(code));
  try {
    assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('secret=do-not-log'), { code: '57P03' })));
    assert.deepEqual(codes, ['POSTGRES_57P03']);
    assert.doesNotThrow(() => pool.emit('error', new Error('token=do-not-log')));
    assert.deepEqual(codes, ['POSTGRES_57P03', 'POSTGRES_IDLE_CONNECTION_ERROR']);
  } finally {
    await pool.end();
  }
});
