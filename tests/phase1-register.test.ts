import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeRegister, register } from '../tools/theta-phase1-register.mjs';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));

test('the stored Phase 1 register is exactly what the rows compute to', () => {
  const stored = JSON.parse(readFileSync(path('docs/operations/THETA_PHASE1_REGISTER_20261002.json'), 'utf8'));
  assert.deepEqual(stored.computed, computeRegister());
  assert.deepEqual(stored.rows, register);
});

test('every in-scope row is classified once, the classes sum to the denominator, and no code-solvable row remains', () => {
  const c = computeRegister();
  assert.equal(c.PASS + c.EXTERNAL_POLICY + c.EXTERNAL_PROVIDER + c.FUTURE_DATA + c.PHASE1_CODE_SOLVABLE_REMAINING, c.PHASE1_TOTAL_ROWS);
  assert.equal(new Set(register.map((row: { id: string }) => row.id)).size, register.length);
  assert.equal(c.PHASE1_CODE_SOLVABLE_REMAINING, 0);
});

test('a PASS row names evidence files that exist; a provider or future-data row never claims a passing test', () => {
  for (const row of register as { id: string; class: string; evidence: string[] }[]) {
    if (row.class === 'PASS') {
      assert.ok(row.evidence.length > 0, row.id);
      for (const file of row.evidence) assert.ok(existsSync(path(file)), `${row.id}: ${file} missing`);
    }
    if (row.class === 'EXTERNAL_PROVIDER' || row.class === 'FUTURE_DATA') assert.equal(row.evidence.length, 0, row.id);
  }
});
