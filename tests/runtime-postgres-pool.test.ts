import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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

test('checked-out Postgres disconnect is handled before it can become an uncaught exception', async () => {
  const codes: string[] = [];
  const pool = createRuntimePostgresPool('postgres://user:secret@localhost:5432/test', (code) => codes.push(code));
  try {
    const checkedOut = new EventEmitter();
    pool.emit('connect', checkedOut as never);
    assert.doesNotThrow(() => checkedOut.emit('error',
      Object.assign(new Error('private database URL'), { code: '57P03' })));
    assert.deepEqual(codes, ['POSTGRES_57P03']);
  } finally {
    await pool.end();
  }
});
