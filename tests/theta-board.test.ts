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

import { execFileSync } from 'node:child_process';
import { boardAsOf } from '../tools/theta-board.mjs';

const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

test('the recorded deployed release is a real ancestor of HEAD and the unreleased-row flags match the runtime source actually changed since it', (t) => {
  const release = boardAsOf.deployedRelease;
  if (git('cat-file', '-e', `${release}^{commit}`) === null) { t.skip('release commit not present in this checkout (shallow clone)'); return; }
  assert.doesNotThrow(() => execFileSync('git', ['merge-base', '--is-ancestor', release, 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' }),
    'the deployed release must be an ancestor of HEAD');
  const changed = (git('diff', '--name-only', release, 'HEAD', '--', ...boardAsOf.runtimeSourcePaths) ?? '').split('\n').filter(Boolean)
    .filter((file) => !file.startsWith('bots/theta/tests/'));
  const flagged = rows.filter((row) => row.unreleased).length;
  if (changed.length === 0) assert.equal(flagged, 0, 'no runtime source changed since the deployed release, so no row may be marked unreleased');
  else assert.ok(flagged > 0, `${changed.length} runtime source files changed since ${release.slice(0, 7)}; the board must mark the affected rows unreleased or record the new release`);
});

test('every row has exactly one release status, a runtime claim names the release it was observed at, and an unreleased row is never counted as observed', () => {
  const allowed = new Set(['SOURCE_ONLY', 'NOT_OBSERVABLE_YET', 'DEPLOYED_NOT_YET_OBSERVED', 'CURRENT_RELEASE_REAL_OBSERVED']);
  for (const row of rows) {
    assert.ok(allowed.has(row.releaseStatus), row.id);
    if (row.runtime) { assert.equal(row.observedAtRelease, boardAsOf.deployedRelease, row.id); assert.equal(row.releaseStatus, 'CURRENT_RELEASE_REAL_OBSERVED'); }
    if (row.unreleased) { assert.equal(row.runtime, 0, row.id); assert.equal(row.releaseStatus, 'SOURCE_ONLY'); }
    if (row.observedAtRelease !== null) assert.match(row.observedAtRelease, /^[0-9a-f]{40}$/, row.id);
  }
  const counts = computeBoard().releaseStatusCounts as Record<string, number>;
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
});
