import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';

// Real PostgreSQL proof for 070: the live CHECK constraint accepts every lifecycle event kind the runtime emits (SHORT_PUT_OPEN was missing
// until 2026-10-07) and still rejects an unknown kind. Everything runs in one transaction that is always rolled back; FK triggers are
// bypassed only inside it.
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('lifecycle_application accepts every emitted event kind (incl. SHORT_PUT_OPEN) and rejects an unknown one', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const store = readFileSync('src/theta/postgres-lifecycle-application-store.ts', 'utf8');
  const emitted = [...new Set([...store.matchAll(/readonly eventKind: '([A-Z_]+)'/g)].map((match) => match[1] as string))];
  assert.ok(emitted.includes('SHORT_PUT_OPEN'));
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const insert = (kind: string) => client.query(`INSERT INTO trade.lifecycle_application(lifecycle_application_id,evidence_key,chain_id,event_kind,
    provider_activity_ref_hash,transition_path_json,applied_at,result_hash) VALUES($1,$2,$3,$4,NULL,'[]'::jsonb,now(),$5)`,
  [randomUUID(), hash(`${kind}:${randomUUID()}`), randomUUID(), kind, hash(kind)]);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const kind of emitted) await insert(kind);
    await client.query('SAVEPOINT unknown');
    await assert.rejects(insert('NOT_A_LIFECYCLE_EVENT'), /lifecycle_application_event_kind_check/);
    await client.query('ROLLBACK TO SAVEPOINT unknown');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release(); await pool.end();
  }
});
