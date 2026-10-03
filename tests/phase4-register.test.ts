import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeRegister, register, STATUSES } from '../tools/theta-phase4-register.mjs';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));
type Row = { ID: string; CURRENT_STATUS: string; TEST: string[]; SOURCE: string[]; [key: string]: unknown };
const rows = register as Row[];

test('the stored Phase 4 register is exactly what the rows compute to, and the denominator is frozen', () => {
  const stored = JSON.parse(readFileSync(path('docs/operations/THETA_PHASE4_REGISTER_20261003.json'), 'utf8'));
  assert.deepEqual(stored.computed, computeRegister());
  assert.deepEqual(stored.rows, register);
  assert.equal(rows.length, 35, 'the Phase 4 denominator is frozen; adding or removing a row needs a deliberate register revision');
});

test('every row has every required field, a unique id and one valid status; classes sum to the total', () => {
  const fields = ['ID', 'CAPABILITY', 'SOURCE', 'TEST', 'CURRENT_STATUS', 'SOLVABILITY', 'RISK', 'EVIDENCE', 'NEXT_ACTION'];
  for (const row of rows) {
    for (const field of fields) assert.ok(field in row, `${row.ID} missing ${field}`);
    assert.ok(STATUSES.includes(row.CURRENT_STATUS), `${row.ID}: ${row.CURRENT_STATUS}`);
  }
  assert.equal(new Set(rows.map((row) => row.ID)).size, rows.length);
  const c = computeRegister();
  assert.equal(c.PASS + c.OWNER_POLICY + c.PROVIDER_LIMITED + c.FUTURE_MARKET + c.FUTURE_PAPER + c.EMPIRICAL_ONLY + c.NOT_APPLICABLE + c.CODE_SOLVABLE_REMAINING, c.PHASE4_TOTAL);
});

test('every source and test a row names exists; PASS rows name a test unless they are a document; unproven classes never claim a PASS test', () => {
  for (const row of rows) {
    for (const file of [...row.SOURCE, ...row.TEST]) assert.ok(existsSync(path(file)), `${row.ID}: ${file} missing`);
    if (row.CURRENT_STATUS === 'PASS') assert.ok(row.TEST.length > 0, `${row.ID} needs a test`);
    if (['FUTURE_PAPER', 'FUTURE_MARKET', 'EMPIRICAL_ONLY'].includes(row.CURRENT_STATUS)) assert.equal(row.TEST.length, 0, row.ID);
  }
});

test('Phase 4 closes with no code-solvable row, and the Production storage budget breach is recorded honestly as an owner decision', () => {
  assert.equal(computeRegister().CODE_SOLVABLE_REMAINING, 0);
  assert.equal(rows.find((row) => row.ID === 'P4-026')?.CURRENT_STATUS, 'OWNER_POLICY');
});
