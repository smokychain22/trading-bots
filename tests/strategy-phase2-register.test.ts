import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeRegister, register, STATUSES } from '../tools/theta-phase2-register.mjs';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));
type Row = { ID: string; STATUS: string; TEST: string[]; SOLVABILITY: string; [key: string]: unknown };
const rows = register as Row[];

test('the stored strategy Phase 2 register is exactly what the rows compute to', () => {
  const stored = JSON.parse(readFileSync(path('docs/operations/THETA_STRATEGY_PHASE2_REGISTER_20261002.json'), 'utf8'));
  assert.deepEqual(stored.computed, computeRegister());
  assert.deepEqual(stored.rows, register);
});

test('every row has every required field, a unique id and exactly one valid status; classes sum to the total', () => {
  const fields = ['ID', 'DOMAIN', 'SOURCE', 'CANONICAL_AUTHORITY', 'CURRENT_BEHAVIOR', 'EXPECTED_BEHAVIOR', 'TEST', 'SOLVABILITY', 'STATUS', 'NEXT_ACTION'];
  for (const row of rows) {
    for (const field of fields) assert.ok(field in row, `${row.ID} missing ${field}`);
    assert.ok(STATUSES.includes(row.STATUS), `${row.ID}: ${row.STATUS}`);
  }
  assert.equal(new Set(rows.map((row) => row.ID)).size, rows.length);
  const c = computeRegister();
  assert.equal(c.PASS + c.OWNER_POLICY + c.PROVIDER_LIMITED + c.FUTURE_MARKET + c.FUTURE_PAPER + c.EMPIRICAL_ONLY + c.NOT_APPLICABLE + c.CODE_SOLVABLE_REMAINING, c.PHASE2_TOTAL);
});

test('Phase 2 has no code-solvable row remaining', () => {
  assert.equal(computeRegister().CODE_SOLVABLE_REMAINING, 0);
});

test('a PASS row names tests that exist; a row that needs future data or an owner never claims a passing test it does not have', () => {
  for (const row of rows) {
    if (row.STATUS === 'PASS') {
      assert.ok(row.TEST.length > 0, `${row.ID} needs a test`);
      for (const file of row.TEST) assert.ok(existsSync(path(file)), `${row.ID}: ${file} missing`);
    }
    if (['FUTURE_MARKET', 'FUTURE_PAPER', 'EMPIRICAL_ONLY', 'PROVIDER_LIMITED'].includes(row.STATUS)) assert.equal(row.TEST.length, 0, row.ID);
    if (row.STATUS === 'OWNER_POLICY') for (const file of row.TEST) assert.ok(existsSync(path(file)), `${row.ID}: ${file} missing`);
  }
});
