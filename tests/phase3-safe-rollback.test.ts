import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rollbackSucceeded } from '../src/database/safe-rollback.js';

test('a successful ROLLBACK reports true; a failing ROLLBACK reports false and never throws or masks the original error', async () => {
  const statements: string[] = [];
  assert.equal(await rollbackSucceeded({ query: async (sql) => { statements.push(sql); return {}; } }), true);
  assert.deepEqual(statements, ['ROLLBACK']);
  assert.equal(await rollbackSucceeded({ query: async () => { throw new Error('connection terminated unexpectedly'); } }), false);
});

test('every raw pool.connect() transaction that rolls back discards a client whose rollback failed', () => {
  for (const file of ['src/customer/postgres-disabled-copy-planner.ts', 'src/research/postgres-shadow-virtual-trader.ts', 'src/customer/paper-account-role.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(/await client\.query\('ROLLBACK'\)/.test(source), false, `${file} still has an unguarded ROLLBACK`);
    assert.match(source, /rollbackSucceeded\(client\)/, file);
    assert.match(source, /client\.release\(discard\s*\?\s*true\s*:\s*undefined\)/, file);
  }
});
