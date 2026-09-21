import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Vercel deploy excludes local worker releases, local secrets and generated research artifacts', () => {
  const ignored = new Set(readFileSync('.vercelignore', 'utf8').split(/\r?\n/).map((line) => line.trim()));
  for (const path of ['.theta-local-worker', '.env*', '.venv', 'research_exports', 'research_outputs']) {
    assert.equal(ignored.has(path), true, `${path} must never be uploaded with a deployment`);
  }
  assert.equal(ignored.has('migrations'), false);
  assert.equal(ignored.has('tests'), false);
});
