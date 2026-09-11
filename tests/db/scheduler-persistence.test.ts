import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresSchedulerCheckpointRepository } from '../../src/theta/postgres-scheduler-checkpoint-repository.js';

test('PostgreSQL scheduler lease is exclusive, restart-visible, and owner guarded', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString: url.toString(), max: 3 });
  try {
    const suffix = `${Date.now()}-${Math.random()}`;
    const jobId = `ORDER_RECONCILIATION:${suffix}`;
    const repo = new PostgresSchedulerCheckpointRepository(pool, 2);
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(await repo.tryAcquireLease(jobId, 'worker-a', future), true);
    assert.equal(await repo.tryAcquireLease(jobId, 'worker-b', future), false);
    assert.equal((await repo.findById(jobId))?.attempt, 1);
    await repo.releaseLease(jobId, 'worker-b');
    assert.equal((await repo.findById(jobId))?.status, 'LEASED');
    await repo.releaseLease(jobId, 'worker-a');
    assert.equal((await repo.findById(jobId))?.status, 'COMPLETED');

    const expiredId = `ORDER_RECONCILIATION:${suffix}-expired`;
    assert.equal(await repo.tryAcquireLease(expiredId, 'crashed', new Date(Date.now() - 1000).toISOString()), true);
    assert.equal((await repo.findExpiredLeases(new Date().toISOString())).some((r) => r.jobId === expiredId), true);
    assert.equal(await repo.tryAcquireLease(expiredId, 'recovery', future), true);
    assert.equal((await repo.findById(expiredId))?.attempt, 2);
    await repo.releaseLease(expiredId, 'recovery');
  } finally { await pool.end(); }
});
