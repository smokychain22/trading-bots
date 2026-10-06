import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The governed production migration sets the exact database it migrates in the PROCESS environment (from the DPAPI-protected source). loadEnvironmentFile gives a
// file precedence over the process, so any post-migration check run with `--environment-file=.env.local` could silently validate a DIFFERENT database
// (this happened: .env.local and the production worker env point at different hosts). Every post-migration check must read the process environment only.
test('post-migration storage audit and stability soak validate the database that was just migrated (process environment), never a file-selected one', () => {
  const script = readFileSync(new URL('../tools/windows/dr/Invoke-ThetaProductionMigration.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /--environment-file=\.env/, 'no post-migration step may read a dotenv file');
  assert.match(script, /theta-storage-audit\.ts','--environment-file=process'/);
  assert.match(script, /theta-postgres-stability-soak\.ts','--environment-file=process'/);
  for (const tool of ['../tools/theta-storage-audit.ts', '../tools/theta-postgres-stability-soak.ts']) {
    assert.match(readFileSync(new URL(tool, import.meta.url), 'utf8'), /=== ?'process' ?\? ?loadEnvironment\(\)/, `${tool} supports the process-only mode`);
  }
});

// The strategy Paper authority receipt is read by the Production runtime from the Production database. Recording it into whatever .env.local
// points at (a non-Production database here) would silently leave H/D unauthorized in Production, so --apply has no default target.
test('the governed strategy-authority writer needs an explicit target and supports the process-only Production mode', () => {
  const tool = readFileSync(new URL('../tools/theta-strategy-authority.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(tool, /\?\? '\.env\.local'/, 'no silent dotenv default');
  assert.match(tool, /APPLY_REQUIRES_EXPLICIT_ENVIRONMENT_FILE/);
  assert.match(tool, /=== 'process' \? loadEnvironment\(\)/);
});
