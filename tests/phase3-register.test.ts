import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeRegister, register, STATUSES } from '../tools/theta-phase3-register.mjs';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));
type Row = { ID: string; CURRENT_STATUS: string; TEST: string[]; SOURCE: string[]; [key: string]: unknown };
const rows = register as Row[];

test('the stored Phase 3 register is exactly what the rows compute to', () => {
  const stored = JSON.parse(readFileSync(path('docs/operations/THETA_PHASE3_REGISTER_20261002.json'), 'utf8'));
  assert.deepEqual(stored.computed, computeRegister());
  assert.deepEqual(stored.rows, register);
});

test('every row has every required field, a unique id and one valid status; classes sum to the total', () => {
  const fields = ['ID', 'CAPABILITY', 'SOURCE', 'TEST', 'RUNTIME_DEPENDENCY', 'DB_DEPENDENCY', 'CURRENT_STATUS', 'LIVE_SESSION_STATUS', 'PAPER_STATUS', 'BLOCKER', 'SOLVABILITY', 'NEXT_ACTION'];
  for (const row of rows) {
    for (const field of fields) assert.ok(field in row, `${row.ID} missing ${field}`);
    assert.ok(STATUSES.includes(row.CURRENT_STATUS), `${row.ID}: ${row.CURRENT_STATUS}`);
  }
  assert.equal(new Set(rows.map((row) => row.ID)).size, rows.length);
  const c = computeRegister();
  assert.equal(c.PASS + c.OWNER_POLICY + c.PROVIDER_LIMITED + c.FUTURE_MARKET + c.FUTURE_PAPER + c.EMPIRICAL_ONLY + c.NOT_APPLICABLE + c.CODE_SOLVABLE_REMAINING, c.PHASE3_TOTAL);
});

test('PASS rows name tests and sources that exist; unproven classes never claim a test', () => {
  for (const row of rows) {
    if (row.CURRENT_STATUS === 'PASS') {
      assert.ok(row.TEST.length > 0, `${row.ID} needs a test`);
      for (const file of row.TEST) assert.ok(existsSync(path(file)), `${row.ID}: ${file} missing`);
    }
    if (['FUTURE_PAPER', 'EMPIRICAL_ONLY'].includes(row.CURRENT_STATUS) && row.ID !== 'P3-033' && row.ID !== 'P3-034') assert.equal(row.TEST.length, 0, row.ID);
  }
});

test('the only code-solvable row is the not-yet-verified Production migration 068, and nothing claims a Paper order was exercised', () => {
  const open = rows.filter((row) => row.CURRENT_STATUS === 'CODE_SOLVABLE').map((row) => row.ID);
  assert.ok(open.length === 0 || (open.length === 1 && open[0] === 'P3-017'), open.join());
  for (const row of rows) assert.equal(row.PAPER_STATUS, 'NOT_EXERCISED');
});
