import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeBoard, rows } from '../tools/theta-board.mjs';

const stored = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/operations/THETA_BOARD_20261001.json', import.meta.url)), 'utf8')) as
  { computed: ReturnType<typeof computeBoard>; rows: typeof rows };

test('the stored board is exactly what the rows compute to: no hand-edited percentage can survive', () => {
  assert.deepEqual(stored.computed, computeBoard());
  assert.deepEqual(stored.rows, rows);
});

test('every percentage names its numerator and denominator, and a percentage never exceeds its denominator', () => {
  const board = computeBoard();
  for (const key of ['preMarketEngineering', 'implementation', 'wiring', 'tested', 'currentReleaseRuntime', 'paperOperation', 'empiricalValidation'] as const) {
    const metric = board[key];
    assert.ok(Number.isInteger(metric.numerator) && Number.isInteger(metric.denominator), key);
    assert.ok(metric.numerator <= metric.denominator, key);
    assert.equal(metric.percent, Math.round((metric.numerator / metric.denominator) * 10000) / 100, key);
  }
});

test('rows cannot over-claim: runtime evidence needs a wired implementation, Paper/empirical claims need applicability, ids are unique', () => {
  const ids = new Set<string>();
  for (const row of rows) {
    assert.ok(!ids.has(row.id), `duplicate ${row.id}`);
    ids.add(row.id);
    assert.ok(row.note.length > 10, `${row.id} needs an evidence note`);
    if (row.runtime) assert.ok(row.impl && row.wired && row.obsNow, `${row.id} claims runtime without implementation, wiring or observability`);
    if (row.paper) assert.ok(row.paperApplicable, `${row.id} claims Paper exercise but is not Paper-applicable`);
    if (row.emp) assert.ok(row.empApplicable, `${row.id} claims empirical validation but is not empirically applicable`);
    if (row.engDone) assert.ok(row.impl && row.tested, `${row.id} cannot be engineering-complete without implementation and tests`);
    if (row.policyBlocked) assert.ok(row.id.length > 0);
  }
});

test('no empirical or Paper claim exists without real resolved outcomes (none do yet) and live is excluded from every denominator', () => {
  const board = computeBoard();
  assert.equal(board.paperOperation.numerator, 0);
  assert.equal(board.empiricalValidation.numerator, 0);
  assert.equal(board.liveGraduation.denominator, null);
});
