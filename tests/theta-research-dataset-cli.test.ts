import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const CLI_PATH = 'tools/theta-research-dataset-cli.ts';
const FIXTURE_PATH = 'tests/fixtures/research-cli-sample-bundle.json';
// Invoked via the real tsx CLI entry + the current Node binary directly
// (never through `npx`/a `.cmd` shell wrapper) -- `execFileSync` on
// Windows cannot spawn a `.cmd` without `shell: true`, and shelling out to
// run a subprocess test is an unnecessary command-injection surface this
// module avoids entirely.
const TSX_CLI = resolve('node_modules/tsx/dist/cli.mjs');

function runCli(args: readonly string[]): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, CLI_PATH, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('CORE CLAIM (overnight §46): the real CLI, run as an actual subprocess, processes a valid bundle end to end', () => {
  const result = runCli([FIXTURE_PATH]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout) as { status: string; bundleId: string; rowCount: number; bundleHash: string };
  assert.equal(parsed.status, 'OK');
  assert.equal(parsed.bundleId, 'cli-smoke-bundle-1');
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.bundleHash.length, 64);
});

test('ADVERSARIAL (overnight §47): a missing file produces a clear, non-crashing typed error', () => {
  const result = runCli(['tests/fixtures/does-not-exist.json']);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('CLI_MISSING_FILE'));
});

test('ADVERSARIAL: corrupt/malformed JSON produces a clear typed error, never a raw stack trace as the only output', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-cli-fixture-'));
  const badPath = join(root, 'corrupt.json');
  writeFileSync(badPath, '{not valid json');
  try {
    const result = runCli([badPath]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('CLI_MALFORMED_JSON'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ADVERSARIAL: an unsupported bundle shape (missing rows array) is rejected with a clear error', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-cli-fixture-'));
  const wrongShapePath = join(root, 'wrong-shape.json');
  writeFileSync(wrongShapePath, JSON.stringify({ notABundle: true }));
  try {
    const result = runCli([wrongShapePath]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('CLI_UNSUPPORTED_BUNDLE_SHAPE'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ADVERSARIAL: a schema-invalid bundle (bad sourceSha) is reported as SCHEMA_INVALID with real failures, not a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-cli-fixture-'));
  const badSchemaPath = join(root, 'bad-schema.json');
  writeFileSync(badSchemaPath, JSON.stringify({
    bundleId: 'b1', decisionAt: '2026-09-26T14:00:00Z', subjectId: 's1', wasSelected: false, wasShadowOnly: true,
    rows: [{
      subjectId: 's1', checkpoint: '15M', observedAt: '2026-09-26T14:15:00Z', marketMarkPrice: 1, impliedVolatility: null,
      underlyingPrice: null, sourceSha: 'not-a-sha', workerSha: null, provenance: 'REAL_SCHEDULED_OBSERVATION',
    }],
  }));
  try {
    const result = runCli([badSchemaPath]);
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    assert.equal(parsed.status, 'SCHEMA_INVALID');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('running with no arguments prints a usage error rather than crashing on undefined', () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('Usage'));
});
