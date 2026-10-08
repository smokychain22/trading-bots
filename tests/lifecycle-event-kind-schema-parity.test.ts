import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runtimeSchemaMaximum, runtimeSchemaMinimum } from '../src/theta/runtime-schema-compatibility.js';

// 2026-10-07: the first real CSP fill failed because the runtime emitted lifecycle event_kind 'SHORT_PUT_OPEN' that the schema CHECK never
// allowed (017, 058). Every kind the application store can write must be allowed by the LATEST migration that defines the constraint.
test('every lifecycle event kind the runtime emits is allowed by the latest lifecycle_application CHECK constraint', () => {
  const store = readFileSync('src/theta/postgres-lifecycle-application-store.ts', 'utf8');
  const emitted = [...new Set([...store.matchAll(/readonly eventKind: '([A-Z_]+)'/g)].map((match) => match[1] as string))].sort();
  assert.ok(emitted.length >= 9 && emitted.includes('SHORT_PUT_OPEN'), `the emitted union is parsed (${emitted.join(',')})`);
  const definitions = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()
    .map((file) => ({ file, sql: readFileSync(`migrations/${file}`, 'utf8') }))
    .filter((migration) => /ADD CONSTRAINT lifecycle_application_event_kind_check CHECK \(event_kind IN \(/.test(migration.sql));
  const latest = definitions.at(-1);
  assert.ok(latest, 'a migration defines the constraint');
  const body = latest.sql.slice(latest.sql.indexOf('lifecycle_application_event_kind_check CHECK (event_kind IN ('));
  const allowed = [...body.slice(0, body.indexOf('))')).matchAll(/'([A-Z_]+)'/g)].map((match) => match[1] as string);
  const missing = emitted.filter((kind) => !allowed.includes(kind));
  assert.deepEqual(missing, [], `${latest.file} must allow every emitted lifecycle event kind`);
});

test('070 remains the runtime ceiling while the unactivated capital-reservation migration is reviewed', () => {
  assert.equal(runtimeSchemaMinimum, '069_multi_leg_order_durability', 'the runtime still runs on the current Production schema');
  assert.equal(runtimeSchemaMaximum, '070_lifecycle_short_put_open_event');
  const newest = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort().at(-1);
  assert.equal(newest, '071_account_capital_reservations.sql');
  const sql = readFileSync('migrations/070_lifecycle_short_put_open_event.sql', 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /INSERT INTO core\.schema_migration\(version,checksum\)\s+VALUES\('070_lifecycle_short_put_open_event'/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE trade\./i, 'additive only');
});
